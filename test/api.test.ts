import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/auth', () => ({ getToken: vi.fn(async (force?: boolean) => (force ? 'fresh-token' : 'token')) }));
import { SpotifyError, api, messageOf, statusOf } from '../src/api';
import { getToken } from '../src/auth';

const res = (status: number, body?: unknown, headers: Record<string, string> = {}) =>
    new Response(body === undefined ? null : JSON.stringify(body), { status, headers });
const fetchMock = vi.fn<(url: string, init: RequestInit) => Promise<Response>>();

beforeEach(() => { fetchMock.mockReset(); vi.stubGlobal('fetch', fetchMock); });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });

describe('api', () => {
    it('calls the Web API with the access token and returns the parsed JSON', async () => {
        fetchMock.mockResolvedValueOnce(res(200, { id: 'me' }));
        expect(await api('/me')).toEqual({ id: 'me' });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.spotify.com/v1/me');
        expect((init.headers as Record<string, string>).Authorization).toBe('Bearer token');
    });
    it('returns null for an empty reply', async () => {
        fetchMock.mockResolvedValueOnce(res(204));
        expect(await api('/me/player/pause', { method: 'PUT' })).toBeNull();
    });
    it('adds query parameters, and sends a body as JSON', async () => {
        fetchMock.mockResolvedValueOnce(res(204));
        await api('/me/player/play', { method: 'PUT', query: { device_id: 'd1' }, body: { uris: ['x'] } });
        const [url, init] = fetchMock.mock.calls[0];
        expect(url).toBe('https://api.spotify.com/v1/me/player/play?device_id=d1');
        expect(init.body).toBe('{"uris":["x"]}');
        expect((init.headers as Record<string, string>)['Content-Type']).toBe('application/json');
    });
    it("uses Spotify's own next-page links as they are", async () => {
        fetchMock.mockResolvedValueOnce(res(200, {}));
        await api('https://api.spotify.com/v1/me/tracks?offset=50&limit=50');
        expect(fetchMock.mock.calls[0][0]).toBe('https://api.spotify.com/v1/me/tracks?offset=50&limit=50');
    });
    it('refreshes the sign-in once after a 401, then retries', async () => {
        fetchMock.mockResolvedValueOnce(res(401)).mockResolvedValueOnce(res(200, { ok: 1 }));
        expect(await api('/me')).toEqual({ ok: 1 });
        expect(vi.mocked(getToken)).toHaveBeenLastCalledWith(true);
    });
    it('gives up if the sign-in is still refused after refreshing', async () => {
        fetchMock.mockResolvedValue(res(401));
        await expect(api('/me')).rejects.toMatchObject({ status: 401 });
        expect(fetchMock).toHaveBeenCalledTimes(2);
    });
    it("waits as long as Spotify asks after a 429, then retries", async () => {
        vi.useFakeTimers();
        fetchMock.mockResolvedValueOnce(res(429, undefined, { 'Retry-After': '3' })).mockResolvedValueOnce(res(200, { ok: 1 }));
        const call = api('/me');
        await vi.advanceTimersByTimeAsync(2_900);
        expect(fetchMock).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(200);
        expect(await call).toEqual({ ok: 1 });
    });
    it('retries a server error twice before giving up', async () => {
        vi.useFakeTimers();
        fetchMock.mockResolvedValue(res(503, { error: { message: 'Busy' } }));
        const call = api('/me').catch((e: unknown) => e as SpotifyError);
        await vi.advanceTimersByTimeAsync(2_000);
        const err = (await call) as SpotifyError;
        expect(fetchMock).toHaveBeenCalledTimes(3);
        expect(err).toBeInstanceOf(SpotifyError);
        expect(err.message).toBe('Busy');
    });
    it("passes on Spotify's error message and status", async () => {
        fetchMock.mockResolvedValueOnce(res(403, { error: { message: 'Premium required' } }));
        const err = await api('/me').catch(e => e);
        expect(statusOf(err)).toBe(403);
        expect(messageOf(err)).toBe('Premium required');
    });
});
