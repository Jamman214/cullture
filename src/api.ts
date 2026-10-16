import { API } from './config';
import { getToken } from './auth';
import { sleep } from './util';

export class SpotifyError extends Error {
    constructor(message: string, readonly status: number) { super(message); }
}

interface ApiOpts {
    method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
    body?: unknown;
    query?: Record<string, string | number>;
}

/**
 * Calls the Spotify Web API. Accepts a path ("/me") or a full URL (Spotify's `next` links).
 * Refreshes the token once on 401, waits on 429, retries brief 5xx errors.
 */
export async function api<T = unknown>(path: string, { method = 'GET', body, query }: ApiOpts = {}): Promise<T> {
    let url = path.startsWith('http') ? path : API + path;
    if (query) {
        const qs = new URLSearchParams(Object.entries(query).map(([k, v]) => [k, String(v)]));
        url += (url.includes('?') ? '&' : '?') + qs;
    }
    let refreshed = false;
    let force = false;
    for (let i = 0; i < 6; i++) {
        const tok = await getToken(force);
        force = false;
        const payload = body === undefined ? undefined : JSON.stringify(body);
        // In test mode the simulated server answers instead; the import is dropped from normal builds.
        const r = __MOCK__
            ? await (await import('./mock/server')).mockFetch(method, url, payload)
            : await fetch(url, {
                method,
                body: payload,
                headers: { Authorization: 'Bearer ' + tok, ...(payload === undefined ? {} : { 'Content-Type': 'application/json' }) }
            });
        if (r.status === 401 && !refreshed) { refreshed = force = true; continue; }
        if (r.status === 429) { await sleep(Math.min(Number(r.headers.get('Retry-After') || 2), 30) * 1000); continue; }
        if (r.status >= 500 && i < 2) { await sleep(700); continue; }
        if (!r.ok) {
            let msg = '';
            try { const j = await r.json(); msg = j.error?.message || j.error_description || ''; } catch { /* no body */ }
            throw new SpotifyError(msg || `Spotify returned ${r.status}`, r.status);
        }
        const txt = await r.text();
        try { return (txt ? JSON.parse(txt) : null) as T; } catch { return null as T; }
    }
    throw new Error('Spotify is rate-limiting requests. Wait a minute and try again.');
}

export const statusOf = (e: unknown): number | undefined => (e instanceof SpotifyError ? e.status : undefined);
export const messageOf = (e: unknown): string => (e instanceof Error ? e.message : String(e));
