/**
 * A stand-in for the Spotify Web API, used by `npm run dev:mock`.
 * api.ts sends every request here instead of to Spotify. It keeps changes in memory,
 * so reloading the page restores the original test library (ratings are kept).
 *
 * Add `?chaos` to the page address to make about 1 in 8 requests fail with
 * a 429 or 503, to test retry handling.
 */
import { API, MOCK_DEVICE } from '../config';
import type { SpotifyTrack } from '../types';
import { buildLibrary, type MockPlaylist } from './data';

const lib = buildLibrary();
const byUri = new Map(lib.tracks.map(t => [t.uri, t]));
const chaos = new URLSearchParams(location.search).has('chaos');
let created = 0;

/** Playlist version IDs, bumped on every edit like Spotify's snapshot_id. */
const revs = new Map<string, number>();
const snapshotOf = (p: MockPlaylist) => `${p.id}-${revs.get(p.id) ?? 0}`;
const bump = (p: MockPlaylist) => { revs.set(p.id, (revs.get(p.id) ?? 0) + 1); return snapshotOf(p); };

/** Simulated playback: a queue of URIs, the current index, and position at time `at`. */
let player: { uris: string[]; index: number; playing: boolean; pos: number; at: number } | null = null;

const json = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
    new Response(body === undefined || status === 204 ? null : JSON.stringify(body), {
        status, headers: { 'Content-Type': 'application/json', ...headers }
    });
const fail = (status: number, message: string, headers?: Record<string, string>) =>
    json(status, { error: { status, message } }, headers);

function page<T>(all: T[], url: URL, path: string) {
    const offset = Number(url.searchParams.get('offset') || 0);
    const limit = Math.min(Number(url.searchParams.get('limit') || 20), 50);
    const next = offset + limit;
    return {
        items: all.slice(offset, next), total: all.length, limit, offset,
        next: next < all.length ? `${API}${path}?offset=${next}&limit=${limit}` : null
    };
}

const playlistObj = (p: MockPlaylist) => ({
    id: p.id, name: p.name, collaborative: p.collaborative,
    images: [{ url: p.image }],
    owner: { id: p.ownerId, display_name: p.ownerName },
    items: { total: p.items.length },
    snapshot_id: snapshotOf(p), external_urls: {}
});

/** Moves simulated playback forward to now, advancing through the queue as songs finish. */
function tick(): void {
    if (!player) return;
    const now = Date.now();
    if (player.playing) {
        let pos = player.pos + (now - player.at);
        for (; ;) {
            const d = byUri.get(player.uris[player.index])?.duration_ms ?? 0;
            if (pos < d) break;
            if (player.index >= player.uris.length - 1) { pos = 0; player.playing = false; break; }
            pos -= d;
            player.index++;
        }
        player.pos = pos;
    }
    player.at = now;
}

interface Body { uris?: string[]; items?: { uri: string }[]; name?: string; position_ms?: number }

export async function mockFetch(method: string, rawUrl: string, payload?: string): Promise<Response> {
    await new Promise(r => setTimeout(r, 60 + Math.random() * 140));
    if (chaos) {
        const x = Math.random();
        if (x < 0.08) return fail(429, 'Rate limited (simulated)', { 'Retry-After': '1' });
        if (x < 0.12) return fail(503, 'Server error (simulated)');
    }

    const url = new URL(rawUrl);
    const path = url.pathname.replace(/^\/v1/, '');
    const data: Body = payload ? JSON.parse(payload) : {};
    const route = `${method} ${path}`;
    const now = () => new Date().toISOString();

    if (route === 'GET /me') return json(200, lib.me);
    if (route === 'GET /me/playlists') return json(200, page(lib.playlists.map(playlistObj), url, '/me/playlists'));
    if (route === 'GET /me/tracks') return json(200, page(lib.liked, url, '/me/tracks'));

    if (route === 'DELETE /me/library') {
        const uris = new Set([...(url.searchParams.get('uris') || '').split(','), ...(data.uris || [])].filter(Boolean));
        lib.liked = lib.liked.filter(l => !uris.has(l.track.uri));
        return json(200);
    }

    if (route === 'POST /me/playlists') {
        const p: MockPlaylist = {
            id: `mockplnew${++created}`, name: data.name || 'New playlist', ownerId: lib.me.id,
            ownerName: lib.me.display_name, collaborative: false, image: lib.playlists[0].image, items: []
        };
        lib.playlists.unshift(p);
        return json(201, playlistObj(p));
    }

    const items = path.match(/^\/playlists\/([^/]+)\/items$/);
    if (items) {
        const p = lib.playlists.find(x => x.id === items[1]);
        if (!p) return fail(404, 'Playlist not found');
        if (p.ownerId !== lib.me.id && !p.collaborative) return fail(403, 'Forbidden');
        if (method === 'GET') return json(200, page(p.items, url, path));
        if (method === 'DELETE') {
            const uris = new Set((data.items || []).map(i => i.uri));
            p.items = p.items.filter(e => !e.item || !uris.has(e.item.uri));
            return json(200, { snapshot_id: bump(p) });
        }
        if (method === 'POST') {
            for (const u of data.uris || []) {
                const t = byUri.get(u);
                if (t) p.items.push({ added_at: now(), item: t });
            }
            return json(201, { snapshot_id: bump(p) });
        }
    }

    if (route === 'GET /me/player/devices') {
        return json(200, { devices: [{ id: MOCK_DEVICE, name: 'Test speaker (simulated)', type: 'Speaker', is_active: !!player }] });
    }

    if (path.startsWith('/me/player')) {
        const device = url.searchParams.get('device_id');
        if (device && device !== MOCK_DEVICE) return fail(404, 'Device not found');
        tick();
        switch (route) {
            case 'PUT /me/player/play':
                if (data.uris?.length) player = { uris: data.uris, index: 0, playing: true, pos: data.position_ms ?? 0, at: Date.now() };
                else if (player) player.playing = true;
                else return fail(404, 'No active device');
                return json(204);
            case 'PUT /me/player/pause':
                if (player) player.playing = false;
                return json(204);
            case 'PUT /me/player/seek':
                if (player) player.pos = Number(url.searchParams.get('position_ms') || 0);
                return json(204);
            case 'GET /me/player': {
                if (!player) return json(204);
                const item: SpotifyTrack | undefined = byUri.get(player.uris[player.index]);
                return json(200, { is_playing: player.playing, progress_ms: Math.round(player.pos), device: { id: MOCK_DEVICE }, item });
            }
        }
    }

    return fail(404, `The test server has no handler for ${route}`);
}
