import { afterEach, describe, expect, it, vi } from 'vitest';
import { SignedOutError, getToken, hasToken } from '../src/auth';
import { KEY } from '../src/config';

const expired = { access: 'old', refresh: 'r1', exp: 0 };
const refreshAnswers = (status: number) => vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })));
afterEach(() => { vi.unstubAllGlobals(); localStorage.clear(); });

describe('refreshing the sign-in', () => {
    it('stays signed in when Spotify is busy', async () => {
        localStorage.setItem(KEY.token, JSON.stringify(expired));
        refreshAnswers(503);
        await expect(getToken()).rejects.not.toBeInstanceOf(SignedOutError);
        expect(hasToken()).toBe(true);
    });
    it('signs out when Spotify refuses the refresh token', async () => {
        localStorage.setItem(KEY.token, JSON.stringify(expired));
        refreshAnswers(400);
        await expect(getToken()).rejects.toBeInstanceOf(SignedOutError);
        expect(hasToken()).toBe(false);
    });
    it('uses the token another tab saved when that tab refreshed first', async () => {
        localStorage.setItem(KEY.token, JSON.stringify(expired));
        vi.stubGlobal('fetch', vi.fn(async () => {
            localStorage.setItem(KEY.token, JSON.stringify({ access: 'new', refresh: 'r2', exp: Date.now() + 60_000 }));
            return new Response('{}', { status: 400 });
        }));
        expect(await getToken()).toBe('new');
    });
});
