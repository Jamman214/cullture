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

/** localStorage keys. */
export const KEY = {
    clientId: 'culler:clientId',
    token: 'culler:token',
    verifier: 'culler:verifier',
    state: 'culler:state',
    ratings: 'culler:ratings',
    opts: 'culler:opts',
    device: 'culler:device',
    sdkDevice: 'culler:sdkDevice',
    lastSource: 'culler:lastSource',
    progress: (sourceId: string) => `culler:prog:${sourceId}`
} as const;
