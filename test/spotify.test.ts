import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api', async importOriginal => ({ ...(await importOriginal<typeof import('../src/api')>()), api: vi.fn() }));
import { SpotifyError, api } from '../src/api';
import { getArtistImages, getSources, getTracks, pickImage } from '../src/spotify';
import type { Source, SpotifyTrack } from '../src/types';

const song = (id: string | null, over: Partial<SpotifyTrack> = {}): SpotifyTrack => ({
    id, uri: `spotify:track:${id}`, name: `Song ${id}`, type: 'track', duration_ms: 180_000,
    artists: [{ name: 'A' }, { name: 'B' }], album: { name: 'Al', images: [{ url: 'big' }, { url: 'small' }] }, ...over
});
const pages = (map: Record<string, unknown>) =>
    vi.mocked(api).mockImplementation(async (path: string) => {
        if (!(path in map)) throw new Error('unexpected request ' + path);
        return map[path] as never;
    });
const playlist: Source = { id: 'p1', name: 'P', total: 0, readable: true, editable: true };

// Braces matter: a function returned from beforeEach is run as a clean-up step after each test.
beforeEach(() => { vi.mocked(api).mockReset(); });

describe('getTracks', () => {
    it('reads every page, in order', async () => {
        pages({
            '/playlists/p1/items?limit=50': { items: [{ item: song('a') }], next: 'NEXT', total: 2 },
            NEXT: { items: [{ item: song('b') }], next: null, total: 2 }
        });
        const tracks = await getTracks(playlist);
        expect(tracks.map(t => [t.id, t.idx])).toEqual([['a', 0], ['b', 1]]);
    });
    it('keeps the details the app shows', async () => {
        pages({ '/playlists/p1/items?limit=50': { items: [{ added_at: '2025-02-02', item: song('a') }], next: null, total: 1 } });
        const [t] = await getTracks(playlist);
        expect(t).toMatchObject({ name: 'Song a', artists: 'A, B', album: 'Al', big: 'big', img: 'small', dur: 180_000, added: '2025-02-02' });
    });
    it('keeps the artists one by one and the release year, when Spotify gives one', async () => {
        pages({
            '/playlists/p1/items?limit=50': {
                items: [{ item: song('a', { album: { name: 'Al', release_date: '1971-11-08' } }) }, { item: song('b') }], next: null, total: 2
            }
        });
        const [a, b] = await getTracks(playlist);
        expect(a).toMatchObject({ artistList: ['A', 'B'], artistIds: ['', ''], year: 1971 });
        expect('year' in b).toBe(false);
    });
    it('skips local files, podcast episodes, empty slots and duplicates', async () => {
        pages({
            '/playlists/p1/items?limit=50': {
                items: [
                    { item: song('a') },
                    { item: song(null, { is_local: true }) },
                    { item: song('ep', { type: 'episode' }) },
                    { item: null },
                    { item: song('a') },
                    { item: song('b') }
                ], next: null, total: 6
            }
        });
        expect((await getTracks(playlist)).map(t => t.id)).toEqual(['a', 'b']);
    });
    it("reads Liked Songs, which use 'track' rather than 'item'", async () => {
        pages({ '/me/tracks?limit=50': { items: [{ track: song('x') }], next: null, total: 1 } });
        const tracks = await getTracks({ ...playlist, id: 'liked', liked: true });
        expect(tracks.map(t => t.id)).toEqual(['x']);
    });
    it("refreshes the playlist's version and song count, so it isn't later flagged as changed", async () => {
        vi.mocked(api).mockImplementation(async (path: string) => (path === '/playlists/p1'
            ? { snapshot_id: 'v9' }
            : { items: [{ item: song('a') }], next: null, total: 7 }) as never);
        const src = { ...playlist, snapshot: 'v1' };
        await getTracks(src);
        expect(vi.mocked(api)).toHaveBeenCalledWith('/playlists/p1', { query: { fields: 'snapshot_id' } });
        expect(src).toMatchObject({ snapshot: 'v9', total: 7 });
    });
    it("keeps the old version if it can't be fetched", async () => {
        pages({ '/playlists/p1/items?limit=50': { items: [], next: null, total: 0 } });
        const src = { ...playlist, snapshot: 'v1' };
        expect(await getTracks(src)).toEqual([]);
        expect(src.snapshot).toBe('v1');
    });
    it('updates the Liked Songs count', async () => {
        pages({ '/me/tracks?limit=50': { items: [], next: null, total: 12 } });
        const src = { ...playlist, id: 'liked', liked: true };
        await getTracks(src);
        expect(src.total).toBe(12);
    });
    it('reports progress after each page', async () => {
        pages({ '/playlists/p1/items?limit=50': { items: [{ item: song('a') }], next: null, total: 1 } });
        const progress = vi.fn();
        await getTracks(playlist, progress);
        expect(progress).toHaveBeenCalledWith(1, 1);
    });
});

describe('getSources', () => {
    const me = { id: 'me' };
    it('lists Liked Songs first, then playlists, marking which can be read', async () => {
        pages({
            '/me/playlists?limit=50': {
                items: [
                    { id: 'mine', name: 'Mine', owner: { id: 'me' }, items: { total: 3 }, snapshot_id: 's1' },
                    { id: 'collab', name: 'Collab', owner: { id: 'friend' }, collaborative: true, tracks: { total: 5 } },
                    { id: 'theirs', name: 'Theirs', owner: { id: 'spotify', display_name: 'Spotify' } },
                    null
                ], next: null, total: 4
            },
            '/me/tracks?limit=1': { items: [], next: null, total: 42 }
        });
        const sources = await getSources(me);
        expect(sources.map(s => [s.id, s.readable])).toEqual([['liked', true], ['mine', true], ['collab', true], ['theirs', false]]);
        expect(sources[0].total).toBe(42);
        expect(sources[1]).toMatchObject({ total: 3, snapshot: 's1' });
        expect(sources[2].total).toBe(5); // older responses call it "tracks"
        expect(sources[3].owner).toBe('Spotify');
    });
    it("still works if the Liked Songs count can't be fetched", async () => {
        vi.mocked(api).mockImplementation(async (path: string) => {
            if (path.startsWith('/me/playlists')) return { items: [], next: null, total: 0 } as never;
            throw new Error('nope');
        });
        expect((await getSources(me))[0].total).toBeNull();
    });
});

describe('artist photos', () => {
    it('picks the smallest image at least 300px wide, else the largest', () => {
        const im = (width: number) => ({ url: `u${width}`, width });
        expect(pickImage([im(640), im(320), im(160)])).toBe('u320');
        expect(pickImage([im(64), im(160)])).toBe('u160');
        expect(pickImage([])).toBe('');
        expect(pickImage(undefined)).toBe('');
    });
    it('asks in one batch', async () => {
        pages({ '/artists': { artists: [{ id: 'x', images: [{ url: 'px', width: 300 }] }, null] } });
        const got: [string, string][] = [];
        await getArtistImages(['x', 'y'], (id, url) => got.push([id, url]));
        expect(got).toEqual([['x', 'px'], ['y', '']]);
        expect(vi.mocked(api)).toHaveBeenCalledWith('/artists', { query: { ids: 'x,y' } });
    });
    it('falls back to one artist at a time when the batch is refused, stopping quietly at the first failure', async () => {
        const asked: string[] = [];
        vi.mocked(api).mockImplementation(async (path: string) => {
            asked.push(path);
            if (path === '/artists') throw new SpotifyError('Forbidden', 403);
            if (path === '/artists/c') throw new SpotifyError('Not found', 404);
            return { id: path, images: [{ url: 'p' + path.slice(-1), width: 300 }] } as never;
        });
        const got: [string, string][] = [];
        await getArtistImages(['a', 'b', 'c', 'd'], (id, url) => got.push([id, url]));
        expect(got).toEqual([['a', 'pa'], ['b', 'pb']]);
        expect(asked).toEqual(['/artists', '/artists/a', '/artists/b', '/artists/c']);
    });
    it('gives up without falling back on other errors', async () => {
        vi.mocked(api).mockRejectedValue(new SpotifyError('Server error', 500));
        const got = vi.fn();
        await getArtistImages(['a'], got);
        expect(got).not.toHaveBeenCalled();
        expect(vi.mocked(api)).toHaveBeenCalledTimes(1);
    });
});
