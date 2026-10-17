/**
 * Saved copies of each playlist's songs, so opening the page doesn't download them again.
 * Songs go in IndexedDB (no practical size limit); a small summary per playlist goes in
 * localStorage so the picker can show cache status without loading every song.
 */
import { KEY, MOCK } from './config';
import type { Source, Track } from './types';
import { LS } from './util';

export interface CacheMeta {
    savedAt: number;
    /** Spotify's version ID for the playlist when saved; changes whenever the playlist is edited. */
    snapshot: string | null;
    /** Spotify's song count when saved; used to spot changes to Liked Songs, which has no version ID. */
    total: number | null;
    count: number;
}

const DB_NAME = MOCK ? 'cullture-mock' : 'cullture';
const STORE = 'sources';
let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
    dbPromise ??= new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
    return dbPromise;
}

async function run<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest<T>): Promise<T> {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const req = fn(db.transaction(STORE, mode).objectStore(STORE));
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

export const cacheMeta = (id: string) => LS.get<CacheMeta | null>(KEY.cache(id), null);

export async function loadCached(id: string): Promise<Track[] | null> {
    if (!cacheMeta(id)) return null;
    try {
        const rec = await run<{ id: string; tracks: Track[] } | undefined>('readonly', s => s.get(id));
        return rec?.tracks ?? null;
    } catch {
        return null;
    }
}

/** Saves the songs; if the browser refuses (e.g. private browsing), the app just downloads next time. */
export async function saveCached(src: Source, tracks: Track[]): Promise<void> {
    try {
        await run('readwrite', s => s.put({ id: src.id, tracks }));
        LS.set(KEY.cache(src.id), {
            savedAt: Date.now(), snapshot: src.snapshot ?? null, total: src.total, count: tracks.length
        } satisfies CacheMeta);
    } catch { /* not cached */ }
}

/** True when Spotify reports the playlist has changed since it was saved. */
export function isStale(src: Source): boolean {
    const m = cacheMeta(src.id);
    if (!m) return false;
    if (src.liked) return src.total != null && m.total != null && src.total !== m.total;
    return !!src.snapshot && !!m.snapshot && src.snapshot !== m.snapshot;
}
