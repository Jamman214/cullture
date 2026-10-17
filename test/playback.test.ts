import { describe, expect, it } from 'vitest';
import { type Context, type Effect, type Playback, initialPlayback, position, transition } from '../src/playback';

/** A song list a, b, c, d, each 200 s long. Nothing is rated unless a test says so. */
function ctx(over: Partial<Context> = {}): Context {
    const order = ['a', 'b', 'c', 'd'];
    return {
        now: 100_000,
        waitForRating: false,
        isRated: () => false,
        duration: () => 200_000,
        next: id => (id === null ? 'a' : order[order.indexOf(id) + 1] ?? null),
        prev: id => order[order.indexOf(id) - 1] ?? null,
        ...over
    };
}

const playing = (over: Partial<Playback> = {}): Playback =>
    ({ mode: 'playing', cur: 'a', pos: 0, at: 100_000, dur: 200_000, alone: false, expect: null, ...over });

const kinds = (fx: Effect[]) => fx.map(f => f.kind);
const toast = (fx: Effect[]) => fx.find((f): f is Extract<Effect, { kind: 'toast' }> => f.kind === 'toast')?.text;

describe('position', () => {
    it('moves on with the clock while playing', () => {
        expect(position(playing({ pos: 10_000, at: 100_000 }), 105_000)).toBe(15_000);
    });
    it('stays put while paused', () => {
        expect(position(playing({ mode: 'paused', pos: 10_000 }), 999_999)).toBe(10_000);
    });
    it('never goes past the end of the song', () => {
        expect(position(playing({ pos: 199_000 }), 200_000)).toBe(200_000);
    });
});

describe('play', () => {
    it('starts the song and asks Spotify to play it with the rest of the list', () => {
        const [s, fx] = transition(initialPlayback, { type: 'play', id: 'b' }, ctx());
        expect(s).toMatchObject({ mode: 'playing', cur: 'b', pos: 0, dur: 200_000, alone: false });
        expect(fx).toContainEqual({ kind: 'play', id: 'b', alone: false, position: 0 });
        expect(fx).toContainEqual({ kind: 'played', id: 'b' });
    });
    it('gives Spotify the song alone when waiting for ratings, so it cannot move on by itself', () => {
        const [s, fx] = transition(initialPlayback, { type: 'play', id: 'b' }, ctx({ waitForRating: true }));
        expect(s.alone).toBe(true);
        expect(fx).toContainEqual({ kind: 'play', id: 'b', alone: true, position: 0 });
    });
    it('can start part-way through', () => {
        const [s] = transition(initialPlayback, { type: 'play', id: 'a', at: 30_000 }, ctx());
        expect(s.pos).toBe(30_000);
    });
    it('expects Spotify to report this song soon', () => {
        const [s] = transition(initialPlayback, { type: 'play', id: 'a' }, ctx());
        expect(s.expect?.id).toBe('a');
    });
});

describe('toggle (play/pause)', () => {
    it('pauses, remembering how far it got', () => {
        const [s, fx] = transition(playing({ pos: 10_000, at: 100_000 }), { type: 'toggle' }, ctx({ now: 104_000 }));
        expect(s).toMatchObject({ mode: 'paused', pos: 14_000 });
        expect(kinds(fx)).toEqual(['pause']);
    });
    it('resumes', () => {
        const [s, fx] = transition(playing({ mode: 'paused' }), { type: 'toggle' }, ctx());
        expect(s.mode).toBe('playing');
        expect(kinds(fx)).toEqual(['resume']);
    });
    it('starts from where to resume when nothing has played yet', () => {
        const [s] = transition(initialPlayback, { type: 'toggle' }, ctx());
        expect(s).toMatchObject({ mode: 'playing', cur: 'a' });
    });
    it('plays the next song after one has ended, not the same one again', () => {
        const [s] = transition(playing({ mode: 'ended', cur: 'b' }), { type: 'toggle' }, ctx());
        expect(s.cur).toBe('c');
    });
    it('does nothing while waiting for a rating', () => {
        const before = playing({ mode: 'waiting' });
        const [s, fx] = transition(before, { type: 'toggle' }, ctx());
        expect(s).toBe(before);
        expect(fx).toEqual([]);
    });
});

describe('next and previous', () => {
    it('moves to the next song', () => {
        expect(transition(playing(), { type: 'next' }, ctx())[0].cur).toBe('b');
    });
    it('ignores a delayed next that is out of date', () => {
        const before = playing({ cur: 'c' });
        expect(transition(before, { type: 'next', from: 'a' }, ctx())[0]).toBe(before);
    });
    it('says so at the end of the list', () => {
        const [s, fx] = transition(playing({ cur: 'd' }), { type: 'next' }, ctx());
        expect(s.cur).toBe('d');
        expect(toast(fx)).toMatch(/End of the list/);
    });
    it('stops waiting at the end of the list rather than beeping forever', () => {
        const [s] = transition(playing({ mode: 'waiting', cur: 'd' }), { type: 'next' }, ctx());
        expect(s.mode).toBe('ended');
    });
    it('moves to the previous song, and does nothing at the start', () => {
        expect(transition(playing({ cur: 'b' }), { type: 'prev' }, ctx())[0].cur).toBe('a');
        const first = playing({ cur: 'a' });
        expect(transition(first, { type: 'prev' }, ctx())[0]).toBe(first);
    });
});

describe('seek', () => {
    it('moves the position and tells Spotify', () => {
        const [s, fx] = transition(playing(), { type: 'seek', ms: 50_000 }, ctx());
        expect(s.pos).toBe(50_000);
        expect(fx).toEqual([{ kind: 'seek', ms: 50_000 }]);
    });
    it('stays within the song', () => {
        expect(transition(playing(), { type: 'seek', ms: -5 }, ctx())[0].pos).toBe(0);
        expect(transition(playing(), { type: 'seek', ms: 9e9 }, ctx())[0].pos).toBe(199_000);
    });
    it('does nothing with no song', () => {
        expect(transition(initialPlayback, { type: 'seek', ms: 1000 }, ctx())[0]).toBe(initialPlayback);
    });
    it('replays a finished song from the chosen point, which stops the waiting', () => {
        const [s, fx] = transition(playing({ mode: 'waiting', pos: 200_000 }), { type: 'seek', ms: 185_000 }, ctx());
        expect(s).toMatchObject({ mode: 'playing', cur: 'a', pos: 185_000 });
        expect(fx).toContainEqual(expect.objectContaining({ kind: 'play', id: 'a', position: 185_000 }));
    });
    it('ignores skipping forward while waiting, since the song is already over', () => {
        const before = playing({ mode: 'waiting', pos: 200_000 });
        expect(transition(before, { type: 'seek', ms: 215_000 }, ctx())[0]).toBe(before);
    });
});

describe('the end of a song (tick)', () => {
    const atEnd = (over: Partial<Playback> = {}) => playing({ pos: 199_800, at: 100_000, ...over });

    it('leaves it to Spotify when it has the rest of the list', () => {
        const before = atEnd();
        expect(transition(before, { type: 'tick' }, ctx())[0]).toBe(before);
    });
    it('starts the next song itself when Spotify was given the song alone', () => {
        expect(transition(atEnd({ alone: true }), { type: 'tick' }, ctx())[0].cur).toBe('b');
    });
    it('waits for a rating when the song is unrated and the preference is on', () => {
        const [s, fx] = transition(atEnd({ alone: true }), { type: 'tick' }, ctx({ waitForRating: true }));
        expect(s.mode).toBe('waiting');
        expect(kinds(fx)).toEqual(['pause']);
    });
    it('moves on from a song that is already rated', () => {
        const [s] = transition(atEnd({ alone: true }), { type: 'tick' }, ctx({ waitForRating: true, isRated: () => true }));
        expect(s).toMatchObject({ mode: 'playing', cur: 'b' });
    });
    it('does nothing before the end', () => {
        const before = playing({ pos: 100_000, alone: true });
        expect(transition(before, { type: 'tick' }, ctx({ waitForRating: true }))[0]).toBe(before);
    });
    it('stops at the end of the list', () => {
        const [s] = transition(atEnd({ cur: 'd', alone: true }), { type: 'tick' }, ctx());
        expect(s.mode).toBe('ended');
    });
    it('moves on when a song gets rated some other way while waiting', () => {
        const [s] = transition(playing({ mode: 'waiting' }), { type: 'tick' }, ctx({ isRated: () => true }));
        expect(s.cur).toBe('b');
    });
});

describe('rated', () => {
    it('moves on from waiting', () => {
        const [s] = transition(playing({ mode: 'waiting' }), { type: 'rated', id: 'a', advance: false }, ctx({ isRated: () => true }));
        expect(s).toMatchObject({ mode: 'playing', cur: 'b' });
    });
    it('moves on shortly after, with auto-advance, and only if still on that song', () => {
        const [s, fx] = transition(playing(), { type: 'rated', id: 'a', advance: true }, ctx({ isRated: () => true }));
        expect(s.cur).toBe('a');
        expect(fx).toEqual([{ kind: 'later', ms: 300, event: { type: 'next', from: 'a' } }]);
    });
    it('stays on the song without auto-advance', () => {
        const before = playing();
        expect(transition(before, { type: 'rated', id: 'a', advance: false }, ctx({ isRated: () => true }))).toEqual([before, []]);
    });
    it('ignores clearing a rating, and ratings for other songs', () => {
        const waiting = playing({ mode: 'waiting' });
        expect(transition(waiting, { type: 'rated', id: 'a', advance: true }, ctx())[0]).toBe(waiting);
        expect(transition(waiting, { type: 'rated', id: 'z', advance: true }, ctx({ isRated: () => true }))[0]).toBe(waiting);
    });
});

describe('prefsChanged', () => {
    it('turning off "wait for a rating" while waiting stops it', () => {
        expect(transition(playing({ mode: 'waiting' }), { type: 'prefsChanged' }, ctx())[0].mode).toBe('ended');
    });
    it('changes nothing otherwise', () => {
        const before = playing();
        expect(transition(before, { type: 'prefsChanged' }, ctx({ waitForRating: true }))[0]).toBe(before);
    });
});

describe('failed', () => {
    it('pauses and says what went wrong', () => {
        const [s, fx] = transition(playing({ expect: { id: 'a', until: 1e9 } }), { type: 'failed', message: 'Nope' }, ctx());
        expect(s).toMatchObject({ mode: 'paused', expect: null });
        expect(toast(fx)).toBe('Nope');
    });
    it('stays idle if nothing was playing', () => {
        expect(transition(initialPlayback, { type: 'failed', message: 'x' }, ctx())[0].mode).toBe('idle');
    });
});

describe('reports from Spotify', () => {
    const report = (id: string | null, paused = false, pos = 5_000) =>
        ({ type: 'spotify' as const, id, paused, pos, dur: 200_000 });

    it('ignores reports about the old song just after starting a new one', () => {
        const before = playing({ cur: 'b', expect: { id: 'b', until: 104_000 } });
        expect(transition(before, report('a', true), ctx())[0]).toBe(before);
    });
    it('stops expecting once the requested song is reported', () => {
        const [s] = transition(playing({ expect: { id: 'a', until: 104_000 } }), report('a'), ctx());
        expect(s.expect).toBeNull();
    });
    it('says so if the requested song never started', () => {
        const [s, fx] = transition(playing({ cur: 'b', expect: { id: 'b', until: 99_000 } }), report(null, true), ctx());
        expect(s.mode).toBe('paused');
        expect(toast(fx)).toMatch(/Nothing started playing/);
    });
    it('follows Spotify moving on to the next song, and marks it played', () => {
        const [s, fx] = transition(playing({ alone: true }), report('b'), ctx());
        expect(s).toMatchObject({ cur: 'b', alone: false });
        expect(fx).toEqual([{ kind: 'played', id: 'b' }]);
    });
    it('follows pausing and the position', () => {
        expect(transition(playing(), report('a', true, 42_000), ctx())[0]).toMatchObject({ mode: 'paused', pos: 42_000 });
    });
    it('treats a "paused" report right at the end as the song finishing', () => {
        const [s] = transition(playing({ pos: 199_000, alone: true }), report('a', true, 0), ctx({ waitForRating: true }));
        expect(s.mode).toBe('waiting');
    });
    it('keeps waiting through reports about the same, finished song', () => {
        const before = playing({ mode: 'waiting' });
        expect(transition(before, report('a', true, 0), ctx())[0]).toBe(before);
    });
    it('keeps the current song when the reported one is not in the list', () => {
        expect(transition(playing(), report(null, false, 7_000), ctx())[0]).toMatchObject({ cur: 'a', pos: 7_000 });
    });
});
