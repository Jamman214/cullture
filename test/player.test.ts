import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api', async importOriginal => ({ ...(await importOriginal<typeof import('../src/api')>()), api: vi.fn(async () => null) }));
import { SpotifyError, api } from '../src/api';
import { computeView } from '../src/list';
import { dispatch, followSpotify, loopIfWaiting, playSong, rateCurrent, toggleTagCurrent } from '../src/player';
import { S, hasTag, rOf, setRating } from '../src/state';
import { reset, track } from './helpers';

/** The songs Cullture asked Spotify to play, in order, from the most recent play request. */
async function sentToSpotify(): Promise<string[]> {
    await vi.waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/me/player/play', expect.anything()));
    const call = vi.mocked(api).mock.calls.filter(c => c[0] === '/me/player/play').at(-1)!;
    return ((call[1] as { body: { uris: string[] } }).body.uris).map(u => u.split(':')[2]);
}

beforeEach(() => {
    vi.mocked(api).mockClear();
    reset(['a', 'b', 'c', 'd', 'e'].map(id => track(id)));
    computeView();
});
afterEach(() => { vi.useRealTimers(); });

describe('what gets sent to the browser player', () => {
    beforeEach(() => { S.sdk = { activateElement: async () => {} } as unknown as Spotify.Player; });
    it('the chosen song and the rest of the list after it', async () => {
        await playSong('b');
        expect(await sentToSpotify()).toEqual(['b', 'c', 'd', 'e']);
    });
    it('skips songs already rated, when that preference is on', async () => {
        setRating(['c'], 3);
        await playSong('a');
        expect(await sentToSpotify()).toEqual(['a', 'b', 'd', 'e']);
    });
    it("keeps rated songs when that preference is off", async () => {
        setRating(['c'], 3);
        S.opts.skipRated = false;
        await playSong('a');
        expect(await sentToSpotify()).toEqual(['a', 'b', 'c', 'd', 'e']);
    });
    it('follows the filtered and sorted list', async () => {
        S.filter.sort = 'title'; S.tracks[4].name = 'A first'; computeView();
        await playSong('e');
        expect(await sentToSpotify()).toEqual(['e', 'a', 'b', 'c', 'd']);
    });
    it('follows the "Play selected" order when set', async () => {
        S.queue = ['d', 'a', 'c'];
        await playSong('d');
        expect(await sentToSpotify()).toEqual(['d', 'a', 'c']);
    });
    it('sends one song at a time when waiting for ratings', async () => {
        S.opts.waitForRating = true;
        await playSong('b');
        expect(await sentToSpotify()).toEqual(['b']);
    });
    it('explains, and sends nothing, when there is nothing to play on', async () => {
        S.deviceId = null;
        await playSong('a');
        await vi.waitFor(() => expect(document.querySelector('#toast')?.textContent).toMatch(/Couldn.t reach the Spotify app/));
        expect(vi.mocked(api)).not.toHaveBeenCalledWith('/me/player/play', expect.anything());
        expect(S.pb.mode).toBe('idle');
    });
});

describe('playing through the Spotify app (no browser player, as on phones)', () => {
    const lastBody = () => vi.mocked(api).mock.calls.filter(c => c[0] === '/me/player/play').at(-1)?.[1]?.body;
    it('plays from the playlist at the chosen song, and picks each next song itself', async () => {
        S.deviceId = 'ph';
        await playSong('b');
        await vi.waitFor(() => expect(lastBody()).toBeTruthy());
        expect(lastBody()).toEqual({ context_uri: 'spotify:playlist:pl', offset: { uri: 'spotify:track:b' }, position_ms: 0 });
        expect(S.pb.alone).toBe(true);
    });
    it('on opening, sets Spotify to repeat only when waiting for ratings, on the active device if none is chosen yet', () => {
        S.deviceId = null;
        S.opts.waitForRating = false;
        loopIfWaiting();
        expect(vi.mocked(api)).not.toHaveBeenCalledWith('/me/player/repeat', expect.anything());
        S.opts.waitForRating = true;
        loopIfWaiting();
        expect(vi.mocked(api)).toHaveBeenCalledWith('/me/player/repeat', { method: 'PUT', query: { state: 'track' } });
    });
    describe('on opening while Spotify is already playing', () => {
        const nowPlaying = (device: object) => vi.mocked(api).mockImplementation(async path => path === '/me/player'
            ? { is_playing: true, progress_ms: 5000, device, item: { id: 'c', uri: 'spotify:track:c', duration_ms: 200_000 } }
            : null);
        afterEach(() => { clearInterval(S.pollTimer!); S.pollTimer = null; });
        it('shows the song and follows that device', async () => {
            S.deviceId = null;
            nowPlaying({ id: 'ph', name: 'iPhone', type: 'Smartphone', is_active: true });
            followSpotify();
            await vi.waitFor(() => expect(S.pb).toMatchObject({ mode: 'playing', cur: 'c' }));
            expect(S.deviceId).toBe('ph');
        });
        it("doesn't follow another tab's browser player", async () => {
            S.deviceId = null;
            nowPlaying({ id: 'tab', name: 'Cullture (this browser)', type: 'Computer', is_active: true });
            followSpotify();
            await vi.waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/me/player', expect.anything()));
            await new Promise(r => setTimeout(r));
            expect(S.deviceId).toBeNull();
            expect(S.pb.cur).toBeNull();
        });
    });
    it('plays Liked Songs from your collection', async () => {
        S.source = { ...S.source!, id: 'liked', liked: true };
        S.me = { id: 'me' };
        S.deviceId = 'ph';
        await playSong('b');
        await vi.waitFor(() => expect(lastBody()).toBeTruthy());
        expect(lastBody()).toMatchObject({ context_uri: 'spotify:user:me:collection', offset: { uri: 'spotify:track:b' } });
    });
    it.each([[true, 'track'], [false, 'off']])('with wait for a rating %s, sets Spotify to repeat %s so it can\'t move on while the app is frozen', async (wait, state) => {
        S.deviceId = 'ph';
        S.opts.waitForRating = wait;
        await playSong('b');
        await vi.waitFor(() => expect(vi.mocked(api)).toHaveBeenCalledWith('/me/player/repeat', expect.objectContaining({ query: { state, device_id: 'ph' } })));
    });
    const devices = (...list: object[]) => vi.mocked(api).mockImplementation(async path =>
        path === '/me/player/devices' ? { devices: list } : null);
    const playedOn = () => vi.mocked(api).mock.calls.find(c => c[0] === '/me/player/play')?.[1]?.query?.device_id;
    beforeEach(() => { S.deviceId = null; });
    afterEach(() => { vi.mocked(api).mockImplementation(async () => null); });

    it('uses the active device', async () => {
        devices({ id: 'tv', name: 'TV', type: 'TV', is_active: false }, { id: 'lap', name: 'Laptop', type: 'Computer', is_active: true });
        await playSong('a');
        await vi.waitFor(() => expect(playedOn()).toBeTruthy());
        expect(playedOn()).toBe('lap');
        expect(document.querySelector('#toast')?.textContent).toBe('Playing on Laptop');
    });
    it('prefers a phone when none is active, and skips restricted ones and other tabs', async () => {
        devices(
            { id: 'r', name: 'Locked', type: 'Smartphone', is_active: true, is_restricted: true },
            { id: 'tv', name: 'TV', type: 'TV', is_active: false },
            { id: 'tab', name: 'Cullture (this browser)', type: 'Computer', is_active: true },
            { id: 'ph', name: 'iPhone', type: 'Smartphone', is_active: false });
        await playSong('a');
        await vi.waitFor(() => expect(playedOn()).toBeTruthy());
        expect(playedOn()).toBe('ph');
        expect(S.deviceId).toBe('ph');
    });
    it.each([404, 502])('forgets the device when Spotify answers %i (app asleep), and looks again next time', async status => {
        S.deviceId = 'ph';
        vi.mocked(api).mockImplementation(async path => {
            if (path === '/me/player/play') throw new SpotifyError('Device not found', status);
            return null;
        });
        await playSong('a');
        await vi.waitFor(() => expect(S.deviceId).toBeNull());
        expect(document.querySelector('#toast')?.textContent).toMatch(/Couldn.t reach the Spotify app/);
    });
});

describe('rating the playing song', () => {
    it('saves the rating, then moves on with auto-advance', async () => {
        vi.useFakeTimers();
        await playSong('a');
        rateCurrent(4);
        expect(rOf('a')).toBe(4);
        expect(S.pb.cur).toBe('a');
        await vi.advanceTimersByTimeAsync(350);
        expect(S.pb.cur).toBe('b');
    });
    it('stays on the song without auto-advance', async () => {
        vi.useFakeTimers();
        S.opts.autoAdvance = false;
        await playSong('a');
        rateCurrent(4);
        await vi.advanceTimersByTimeAsync(350);
        expect(S.pb.cur).toBe('a');
    });
    it('shows the rating in the player bar', async () => {
        await playSong('a');
        rateCurrent(3);
        expect(document.querySelector('#dStars')?.getAttribute('data-r')).toBe('3');
    });
});

describe('waiting for a rating', () => {
    it('beeps-and-waits state shows in the player bar, and rating moves on', async () => {
        S.opts.waitForRating = true;
        await playSong('a');
        // the song reaches its end: the app's clock says so on the next tick
        S.pb = { ...S.pb, pos: S.pb.dur, at: Date.now() };
        dispatch({ type: 'tick' });
        expect(S.pb.mode).toBe('waiting');
        expect(document.querySelector('#deck')?.classList.contains('waiting')).toBe(true);
        expect((document.querySelector('#playBtn') as HTMLButtonElement).disabled).toBe(true);
        rateCurrent(5);
        expect(S.pb.cur).toBe('b');
        expect(document.querySelector('#deck')?.classList.contains('waiting')).toBe(false);
    });
});

describe('tagging the playing song', () => {
    it('toggles a tag and shows it in the player bar', async () => {
        await playSong('a');
        toggleTagCurrent('inst');
        expect(hasTag('a', 'inst')).toBe(true);
        expect(document.querySelectorAll('#dTags .tag')).toHaveLength(1);
        toggleTagCurrent('inst');
        expect(hasTag('a', 'inst')).toBe(false);
    });
    it('does nothing with nothing playing', () => {
        toggleTagCurrent('hid');
        expect(S.ratings).toEqual({});
    });
});
