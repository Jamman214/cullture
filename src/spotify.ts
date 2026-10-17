/** Spotify data operations: reading playlists and songs, removing songs, creating playlists. */
import { api, statusOf } from './api';
import { LIKED_BATCH, PAGE, WRITE_BATCH } from './config';
import type {
    Paging, Source, SpotifyListItem, SpotifyPlaylist, SpotifyUser, Track
} from './types';
import { chunk } from './util';

export const getMe = () => api<SpotifyUser>('/me');

export async function getSources(me: SpotifyUser): Promise<Source[]> {
    const lists: SpotifyPlaylist[] = [];
    let next: string | null = `/me/playlists?limit=${PAGE}`;
    while (next) {
        const pg: Paging<SpotifyPlaylist | null> = await api(next);
        lists.push(...(pg.items || []).filter((p): p is SpotifyPlaylist => !!p));
        next = pg.next;
    }
    let likedTotal: number | null = null;
    try { likedTotal = (await api<Paging<unknown>>('/me/tracks?limit=1')).total; } catch { /* leave unknown */ }

    return [
        { id: 'liked', name: 'Liked Songs', liked: true, total: likedTotal, readable: true, editable: true },
        ...lists.map(p => {
            // Since Feb 2026, Spotify only returns the contents of playlists you own or collaborate on.
            const mine = p.owner?.id === me.id || !!p.collaborative;
            return {
                id: p.id, name: p.name, img: p.images?.[0]?.url ?? null,
                total: (p.items ?? p.tracks)?.total ?? null,
                owner: p.owner?.display_name, readable: mine, editable: mine,
                snapshot: p.snapshot_id ?? null
            };
        })
    ];
}

export async function getTracks(src: Source, onProgress?: (loaded: number, total: number) => void): Promise<Track[]> {
    const out: Track[] = [];
    const seen = new Set<string>();
    let next: string | null = src.liked ? `/me/tracks?limit=${PAGE}` : `/playlists/${src.id}/items?limit=${PAGE}`;
    while (next) {
        const pg: Paging<SpotifyListItem> = await api(next);
        for (const it of pg.items || []) {
            const t = it.item ?? it.track;
            if (!t || !t.id || t.is_local || (t.type && t.type !== 'track') || seen.has(t.id)) continue;
            seen.add(t.id);
            const imgs = t.album?.images || [];
            out.push({
                id: t.id, uri: t.uri, name: t.name,
                artists: (t.artists || []).map(a => a.name).join(', '),
                album: t.album?.name || '',
                img: (imgs[imgs.length - 1] || imgs[0])?.url || '',
                big: imgs[0]?.url || '',
                dur: t.duration_ms || 0,
                added: it.added_at || '',
                idx: out.length
            });
        }
        onProgress?.(out.length, pg.total);
        next = pg.next;
    }
    return out;
}

async function removeLiked(uris: string[]): Promise<void> {
    try {
        await api('/me/library', { method: 'DELETE', query: { uris: uris.join(',') } });
    } catch (e) {
        const s = statusOf(e);
        if (s !== 400 && s !== 404 && s !== 405) throw e;
        try {
            await api('/me/library', { method: 'DELETE', body: { uris } });
        } catch {
            // Pre-2026 endpoint
            await api('/me/tracks', { method: 'DELETE', query: { ids: uris.map(u => u.split(':')[2]).join(',') } });
        }
    }
}

/**
 * Removes songs in batches. Calls onBatch after each batch so partial progress is known if it fails,
 * with the playlist's new version ID (none for Liked Songs).
 */
export async function removeFromSource(src: Source, uris: string[], onBatch: (doneUris: string[], snapshot?: string) => void): Promise<void> {
    for (const part of chunk(uris, src.liked ? LIKED_BATCH : WRITE_BATCH)) {
        if (src.liked) { await removeLiked(part); onBatch(part); continue; }
        const res = await api<{ snapshot_id?: string } | null>(`/playlists/${src.id}/items`, { method: 'DELETE', body: { items: part.map(uri => ({ uri })) } });
        onBatch(part, res?.snapshot_id);
    }
}

export async function createPlaylist(me: SpotifyUser, name: string, uris: string[]): Promise<SpotifyPlaylist> {
    const body = { name, public: false, description: 'Songs I kept, sorted with Cullture' };
    let pl: SpotifyPlaylist;
    try {
        pl = await api<SpotifyPlaylist>('/me/playlists', { method: 'POST', body });
    } catch (e) {
        const s = statusOf(e);
        if (s !== 404 && s !== 405) throw e;
        pl = await api<SpotifyPlaylist>(`/users/${me.id}/playlists`, { method: 'POST', body });
    }
    for (const part of chunk(uris, WRITE_BATCH)) {
        await api(`/playlists/${pl.id}/items`, { method: 'POST', body: { uris: part } });
    }
    return pl;
}
