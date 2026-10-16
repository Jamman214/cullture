import { ACCOUNTS, KEY, MOCK, REDIRECT, SCOPES } from './config';
import { LS } from './util';

interface StoredToken { access: string; refresh?: string; exp: number }
interface TokenResponse { access_token: string; refresh_token?: string; expires_in: number; error?: string; error_description?: string }

export class SignedOutError extends Error {
    readonly signedOut = true;
}

const b64url = (buf: ArrayBuffer | Uint8Array) =>
    btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

const randStr = (n: number) => {
    const a = new Uint8Array(n);
    crypto.getRandomValues(a);
    return b64url(a).slice(0, n);
};

export const getClientId = () => (MOCK ? 'mock' : LS.get<string | null>(KEY.clientId, null));
export const setClientId = (id: string) => LS.set(KEY.clientId, id);
export const hasToken = () => MOCK || !!LS.get<StoredToken | null>(KEY.token, null);
export const signOut = () => LS.del(KEY.token);

/** Starts the Authorization Code + PKCE flow by redirecting to Spotify. */
export async function login(): Promise<void> {
    if (MOCK) { location.reload(); return; }
    const clientId = getClientId();
    if (!clientId) throw new Error('Missing Client ID');
    const verifier = randStr(64);
    const state = randStr(16);
    LS.set(KEY.verifier, verifier);
    LS.set(KEY.state, state);
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    location.href = `${ACCOUNTS}/authorize?` + new URLSearchParams({
        response_type: 'code', client_id: clientId, scope: SCOPES, redirect_uri: REDIRECT,
        code_challenge_method: 'S256', code_challenge: challenge, state
    });
}

/** Completes sign-in if the page was opened by Spotify's redirect. */
export async function handleRedirect(): Promise<void> {
    const q = new URLSearchParams(location.search);
    if (!q.has('code') && !q.has('error')) return;
    history.replaceState(null, '', REDIRECT);
    if (q.get('error')) throw new Error(`Spotify sign-in did not finish (${q.get('error')}).`);
    if (q.get('state') !== LS.get<string | null>(KEY.state, null)) throw new Error('Sign-in check failed. Connect again.');

    const r = await fetch(`${ACCOUNTS}/api/token`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
            grant_type: 'authorization_code',
            code: q.get('code') ?? '',
            redirect_uri: REDIRECT,
            client_id: getClientId() ?? '',
            code_verifier: LS.get<string>(KEY.verifier, '')
        })
    });
    const j = (await r.json().catch(() => ({}))) as Partial<TokenResponse>;
    if (!r.ok || !j.access_token) {
        throw new Error(`Spotify refused the sign-in: ${j.error_description || j.error || r.status}. Check the Redirect URI and user list in your app settings.`);
    }
    saveToken(j as TokenResponse);
    LS.del(KEY.verifier);
    LS.del(KEY.state);
}

function saveToken(t: TokenResponse): void {
    const old = LS.get<Partial<StoredToken>>(KEY.token, {});
    LS.set(KEY.token, {
        access: t.access_token,
        refresh: t.refresh_token || old.refresh,
        exp: Date.now() + (t.expires_in - 60) * 1000
    } satisfies StoredToken);
}

let refreshing: Promise<void> | null = null;

/** Returns a valid access token, refreshing it when expired (or when `force` is true). */
export async function getToken(force = false): Promise<string> {
    if (MOCK) return 'mock-token';
    const t = LS.get<StoredToken | null>(KEY.token, null);
    if (!t) throw new SignedOutError('Signed out');
    if (!force && Date.now() < t.exp) return t.access;

    refreshing ??= (async () => {
        const r = await fetch(`${ACCOUNTS}/api/token`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: t.refresh ?? '', client_id: getClientId() ?? '' })
        });
        if (!r.ok) {
            LS.del(KEY.token);
            throw new SignedOutError('Your Spotify session expired. Connect again.');
        }
        saveToken((await r.json()) as TokenResponse);
    })().finally(() => { refreshing = null; });

    await refreshing;
    const fresh = LS.get<StoredToken | null>(KEY.token, null);
    if (!fresh) throw new SignedOutError('Signed out');
    return fresh.access;
}
