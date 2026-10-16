import { KEY } from './config';
import { toast } from './toast';
import type { Filter, Opts, Ratings, Source, Track, SpotifyUser } from './types';
import { LS } from './util';

export interface AppState {
    me: SpotifyUser | null;
    sources: Source[];
    source: Source | null;
    tracks: Track[];
    byId: Map<string, Track>;
    view: Track[];
    sel: Set<string>;
    anchor: string | null;
    /** When set, playback order follows this list (e.g. "Play selected") instead of the visible list. */
    queue: string[] | null;
    filter: Filter;
    ratings: Ratings;
    opts: Opts;
    cur: string | null;
    /** True while stopped at the end of a song, beeping for a rating. */
    waiting: boolean;
    /** The song whose end has already been handled, so it isn't handled twice. */
    endedFor: string | null;
    /** True when Spotify was given only the current song, so the app must start the next one itself. */
    queuedAlone: boolean;
    playing: boolean;
    pos: number;
    dur: number;
    posAt: number;
    dragging: boolean;
    sdk: Spotify.Player | null;
    sdkDevice: string | null;
    deviceId: string | null;
    deviceName: string | null;
    pollTimer: number | null;
}

export const S: AppState = {
    me: null, sources: [], source: null, tracks: [], byId: new Map(), view: [],
    sel: new Set(), anchor: null, queue: null,
    filter: { q: '', status: 'all', ratings: new Set(), sort: 'order' },
    ratings: LS.get<Ratings>(KEY.ratings, {}),
    opts: { skipRated: true, autoAdvance: true, waitForRating: false, ...LS.get<Partial<Opts>>(KEY.opts, {}) },
    cur: null, waiting: false, endedFor: null, queuedAlone: false, playing: false, pos: 0, dur: 0, posAt: 0, dragging: false,
    sdk: null, sdkDevice: null, deviceId: LS.get<string | null>(KEY.device, null), deviceName: null, pollTimer: null
};

const storageError = () => toast('Could not save to browser storage. Export your ratings as a backup.');

let saveTimer: number | undefined;
export function saveRatings(): void {
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => LS.set(KEY.ratings, S.ratings, storageError), 250);
}
export function flushRatings(): void {
    clearTimeout(saveTimer);
    LS.set(KEY.ratings, S.ratings, storageError);
}
export function saveOpts(): void { LS.set(KEY.opts, S.opts); }

export const rOf = (id: string | null | undefined): number => (id && S.ratings[id]?.r) || 0;
export const playedOf = (id: string): boolean => !!(S.ratings[id]?.p || S.ratings[id]?.r);

export function setRating(ids: string[], r: number | null): void {
    for (const id of ids) {
        const e = S.ratings[id] || (S.ratings[id] = {});
        if (r) { e.r = r; e.t = Date.now(); } else delete e.r;
        if (!e.r && !e.p) delete S.ratings[id];
    }
    saveRatings();
}

/** Records the first play of a song. Returns true if this is a new play (so the UI should refresh). */
export function markPlayed(id: string): boolean {
    const e = S.ratings[id] || (S.ratings[id] = {});
    if (e.p) return false;
    e.p = Date.now();
    saveRatings();
    return true;
}

export function setTracks(tracks: Track[]): void {
    S.tracks = tracks;
    S.tracks.forEach((t, i) => { t.idx = i; });
    S.byId = new Map(S.tracks.map(t => [t.id, t]));
    for (const id of [...S.sel]) if (!S.byId.has(id)) S.sel.delete(id);
}
