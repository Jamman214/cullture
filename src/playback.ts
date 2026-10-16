/**
 * Playback as a state machine.
 *
 * All playback state is one `Playback` value, and the only way to change it is
 * `transition(state, event, context)`. That returns the new state plus a list of
 * effects (Spotify requests, marking a song played, a toast...) for player.ts to
 * carry out. This file never touches the page, the network or the clock, so every
 * rule about playback lives here and can be read, and tested, on its own.
 *
 *   idle ──play──▶ playing ◀──toggle──▶ paused
 *                    │ ▲
 *   song ends,       │ │  rated, or seek back
 *   still unrated    ▼ │
 *                  waiting ──"wait for a rating" turned off──▶ ended
 *
 *   A song ending with nothing left to play also goes to ended.
 *   From ended, play or next starts the next song.
 *
 * The UI is drawn from this state (player.ts renderDeck), and the reminder beep is
 * on exactly when mode is 'waiting', so nothing needs switching on and off by hand.
 */

export type Mode = 'idle' | 'playing' | 'paused' | 'waiting' | 'ended';

export interface Playback {
    mode: Mode;
    /** The current song's ID. */
    cur: string | null;
    /** Position in ms at time `at`. While playing, the real position is pos + (now - at). */
    pos: number;
    at: number;
    /** Length of the current song in ms. */
    dur: number;
    /** Spotify was given only this song, so it won't move on by itself and the app must. */
    alone: boolean;
    /** A song we've just asked Spotify to play; reports about other songs are ignored until it starts. */
    expect: { id: string; until: number } | null;
}

export const initialPlayback: Playback = {
    mode: 'idle', cur: null, pos: 0, at: 0, dur: 0, alone: false, expect: null
};

export type PlaybackEvent =
    /** Start a song, optionally part-way through. */
    | { type: 'play'; id: string; at?: number }
    /** The play/pause button or Space. */
    | { type: 'toggle' }
    /** Next song. `from` makes a delayed "next" do nothing if the song has changed since. */
    | { type: 'next'; from?: string }
    | { type: 'prev' }
    | { type: 'seek'; ms: number }
    /** What Spotify says is happening. `id` is null if the song isn't in the open list. */
    | { type: 'spotify'; id: string | null; paused: boolean; pos: number; dur: number }
    /** Sent four times a second, to notice a song ending. */
    | { type: 'tick' }
    /** A song's rating changed. `advance` asks to move on (the "go to next song after rating" option). */
    | { type: 'rated'; id: string; advance: boolean }
    /** A preference changed. */
    | { type: 'prefsChanged' }
    /** A Spotify request failed. */
    | { type: 'failed'; message: string };

export type Effect =
    /** Ask Spotify to play `id` from `position`, alone or followed by the rest of the list. */
    | { kind: 'play'; id: string; alone: boolean; position: number }
    | { kind: 'pause' }
    | { kind: 'resume' }
    | { kind: 'seek'; ms: number }
    /** Record the song as played. */
    | { kind: 'played'; id: string }
    | { kind: 'toast'; text: string }
    /** Send `event` after `ms`. */
    | { kind: 'later'; ms: number; event: PlaybackEvent };

/** What the machine needs to know about the rest of the app, passed in so this file stays pure. */
export interface Context {
    now: number;
    waitForRating: boolean;
    isRated(id: string): boolean;
    /** Song length in ms, or 0 if unknown. */
    duration(id: string): number;
    /** The song to play after `id`, or where to start when `id` is null. */
    next(id: string | null): string | null;
    prev(id: string): string | null;
}

export type Result = [Playback, Effect[]];

/** How close to the end counts as "ended", by the app's own clock and by a "paused" report from Spotify. */
const END_MARGIN = 400;
const REPORT_MARGIN = 2000;
/** How long to ignore reports about other songs after asking Spotify to play one. */
const EXPECT_MS = 4000;

export const position = (s: Playback, now: number): number =>
    s.mode === 'playing' ? Math.min(s.dur, s.pos + (now - s.at)) : s.pos;

export function transition(s: Playback, e: PlaybackEvent, c: Context): Result {
    switch (e.type) {
        case 'play':
            return start(e.id, e.at ?? 0, c);

        case 'toggle':
            switch (s.mode) {
                case 'playing': return [{ ...s, mode: 'paused', pos: position(s, c.now), at: c.now }, [{ kind: 'pause' }]];
                case 'paused': return [{ ...s, mode: 'playing', at: c.now }, [{ kind: 'resume' }]];
                case 'idle':
                case 'ended': return advance(s, c);
                case 'waiting': return [s, []]; // rate the song, or seek back, to carry on
            }
            return [s, []];

        case 'next':
            if (e.from && e.from !== s.cur) return [s, []];
            return advance(s, c);

        case 'prev': {
            const id = s.cur && c.prev(s.cur);
            return id ? start(id, 0, c) : [s, []];
        }

        case 'seek': {
            if (!s.cur || s.mode === 'idle') return [s, []];
            const ms = Math.max(0, Math.min(s.dur - 1000, e.ms));
            if (s.mode === 'waiting' || s.mode === 'ended') {
                // The song is over; seeking back plays it again from there. Forward has nowhere to go.
                if (ms >= s.dur - 1000) return [s, []];
                return start(s.cur, ms, c);
            }
            return [{ ...s, pos: ms, at: c.now }, [{ kind: 'seek', ms }]];
        }

        case 'tick':
            // Catches a rating given any other way while waiting.
            if (s.mode === 'waiting' && s.cur && c.isRated(s.cur)) return advance(s, c);
            return endsNow(s, c, END_MARGIN) ? ended(s, c) : [s, []];

        case 'spotify':
            return report(s, e, c);

        case 'rated':
            if (e.id !== s.cur || !c.isRated(e.id)) return [s, []];
            if (s.mode === 'waiting') return advance(s, c);
            if (e.advance && (s.mode === 'playing' || s.mode === 'paused')) {
                // A short pause so the rating animation is visible before the song changes.
                return [s, [{ kind: 'later', ms: 300, event: { type: 'next', from: e.id } }]];
            }
            return [s, []];

        case 'prefsChanged':
            // Turning "wait for a rating" off while waiting: stop, and let play or next carry on.
            if (s.mode === 'waiting' && !c.waitForRating) return [{ ...s, mode: 'ended' }, []];
            return [s, []];

        case 'failed':
            return [
                { ...s, mode: s.cur ? 'paused' : 'idle', pos: position(s, c.now), at: c.now, expect: null },
                [{ kind: 'toast', text: e.message }]
            ];
    }
}

/** Starts a song. With "wait for a rating" on, Spotify gets it alone so it can't move on by itself. */
function start(id: string, at: number, c: Context): Result {
    const alone = c.waitForRating;
    return [
        { mode: 'playing', cur: id, pos: at, at: c.now, dur: c.duration(id), alone, expect: { id, until: c.now + EXPECT_MS } },
        [{ kind: 'play', id, alone, position: at }, { kind: 'played', id }]
    ];
}

/** Moves to the next song, or reports the end of the list. */
function advance(s: Playback, c: Context): Result {
    const id = c.next(s.cur);
    if (id) return start(id, 0, c);
    return [
        s.mode === 'waiting' ? { ...s, mode: 'ended' } : s,
        [{ kind: 'toast', text: 'End of the list. Everything shown here is rated.' }]
    ];
}

/**
 * True when a playing song has reached its end and the app has to act. That's only when
 * "wait for a rating" is on, or Spotify was given the song alone; otherwise Spotify moves on itself.
 */
function endsNow(s: Playback, c: Context, margin: number): boolean {
    return s.mode === 'playing' && !!s.cur && s.dur > 0 && (c.waitForRating || s.alone)
        && position(s, c.now) >= s.dur - margin;
}

/** A song has finished: wait for a rating, move on, or stop at the end of the list. */
function ended(s: Playback, c: Context): Result {
    const done: Playback = { ...s, pos: s.dur, at: c.now };
    if (c.waitForRating && s.cur && !c.isRated(s.cur)) return [{ ...done, mode: 'waiting' }, [{ kind: 'pause' }]];
    const id = c.next(s.cur);
    if (id) return start(id, 0, c);
    return [{ ...done, mode: 'ended' }, [{ kind: 'pause' }]];
}

/** Brings the state in line with what Spotify reports. */
function report(s: Playback, e: Extract<PlaybackEvent, { type: 'spotify' }>, c: Context): Result {
    let expect = s.expect;
    if (expect) {
        if (e.id === expect.id || c.now >= expect.until) expect = null;
        else return [s, []]; // still about the previous song; Spotify hasn't switched yet
    }
    const s2 = expect === s.expect ? s : { ...s, expect };
    const sameSong = !e.id || e.id === s.cur;

    // Spotify pausing right at the end of the song means it finished.
    if (e.paused && sameSong && endsNow(s2, c, REPORT_MARGIN)) return ended(s2, c);

    // A finished song stays finished, unless a different song has started playing.
    if ((s.mode === 'waiting' || s.mode === 'ended') && (sameSong || e.paused)) return [s2, []];

    const cur = e.id ?? s.cur;
    if (!cur) return [s2, []];
    const changed = cur !== s.cur;
    return [
        {
            mode: e.paused ? 'paused' : 'playing', cur, pos: e.pos, at: c.now,
            dur: e.dur || c.duration(cur),
            alone: changed ? false : s.alone, // Spotify moved on by itself, so this song wasn't queued alone
            expect
        },
        changed ? [{ kind: 'played', id: cur }] : []
    ];
}
