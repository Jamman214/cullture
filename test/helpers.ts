/** Shared test data and a way to put the app's state back to a clean start between tests. */
import { initialPlayback } from '../src/playback';
import { S, setTracks } from '../src/state';
import type { Source, Track } from '../src/types';

export function track(id: string, over: Partial<Track> = {}): Track {
    return {
        id, uri: `spotify:track:${id}`, name: `Song ${id}`, artists: `Artist ${id}`, album: `Album ${id}`,
        img: '', big: '', dur: 200_000, added: '2025-01-01T00:00:00Z', idx: 0, ...over
    };
}

export const playlist: Source = { id: 'pl', name: 'Test list', total: 0, readable: true, editable: true, snapshot: 'v1' };

/** Clean state: no ratings, default filters and preferences, nothing playing, and these songs loaded. */
export function reset(tracks: Track[] = []): void {
    localStorage.clear();
    S.ratings = {};
    S.opts = { skipRated: true, autoAdvance: true, waitForRating: false };
    S.filter = { q: '', status: 'all', ratings: new Set(), sort: 'order', tags: new Map() };
    S.sel = new Set();
    S.anchor = null;
    S.queue = null;
    S.pb = initialPlayback;
    S.deviceId = 'test-device';
    S.sdk = null;
    S.source = { ...playlist, total: tracks.length };
    setTracks(tracks);
    S.view = [...S.tracks];
}
