/** Test mode: Spotify is replaced by the simulated server in src/mock/. */
export const MOCK = __MOCK__;
export const MOCK_DEVICE = 'mock-device';

export const API = 'https://api.spotify.com/v1';
export const ACCOUNTS = 'https://accounts.spotify.com';
export const SDK_URL = 'https://sdk.scdn.co/spotify-player.js';
export const REDIRECT = location.origin + location.pathname;

export const SCOPES = [
    'user-library-read', 'user-library-modify',
    'playlist-read-private', 'playlist-read-collaborative',
    'playlist-modify-private', 'playlist-modify-public',
    'streaming', 'user-read-playback-state', 'user-modify-playback-state',
    'user-read-private', 'user-read-email'
].join(' ');

/** Spotify lowered per-request limits for Development Mode apps in Feb 2026; small batches are safe. */
export const WRITE_BATCH = 10;
export const LIKED_BATCH = 40;
export const PAGE = 50;

/** localStorage keys. Test mode uses its own prefix so test ratings never mix with real ones. */
const P = __MOCK__ ? 'culler-mock:' : 'culler:';
export const KEY = {
    clientId: P + 'clientId',
    token: P + 'token',
    verifier: P + 'verifier',
    state: P + 'state',
    ratings: P + 'ratings',
    opts: P + 'opts',
    device: P + 'device',
    sdkDevice: P + 'sdkDevice',
    lastSource: P + 'lastSource',
    progress: (sourceId: string) => `${P}prog:${sourceId}`,
    cache: (sourceId: string) => `${P}cache:${sourceId}`
} as const;
