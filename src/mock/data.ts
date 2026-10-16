/**
 * Test library for `npm run dev:mock`. Generated from a fixed seed, so the same
 * songs, playlists and IDs appear on every run and saved test ratings stay valid.
 */
import type { SpotifyTrack } from '../types';

export interface MockEntry { added_at: string; item: SpotifyTrack | null }
export interface MockPlaylist {
    id: string;
    name: string;
    ownerId: string;
    ownerName: string;
    collaborative: boolean;
    image: string;
    items: MockEntry[];
}
export interface MockLibrary {
    me: { id: string; display_name: string };
    tracks: SpotifyTrack[];
    liked: { added_at: string; track: SpotifyTrack }[];
    playlists: MockPlaylist[];
}

/** Small seeded random number generator (mulberry32). */
function seeded(seed: number): () => number {
    return () => {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

const ADJ = ['Velvet', 'Neon', 'Paper', 'Golden', 'Hollow', 'Electric', 'Quiet', 'Midnight', 'Silver', 'Broken', 'Wild', 'Slow',
    'Crystal', 'Faded', 'Burning', 'Lonely', 'Northern', 'Sugar', 'Static', 'Endless', 'Cold', 'Lucky', 'Lost', 'Bright'];
const NOUN = ['Hearts', 'Skyline', 'Rivers', 'Summer', 'Echoes', 'Lights', 'Machines', 'Gardens', 'Waves', 'Dreams', 'Highway', 'Ghosts',
    'Satellites', 'Shadows', 'Tides', 'Mirrors', 'Fires', 'Winter', 'Signals', 'Horizons', 'Roses', 'Stars', 'Streets', 'Thunder'];
const VERB = ['Running', 'Falling', 'Dancing', 'Waiting', 'Breathing', 'Drifting', 'Calling', 'Holding', 'Chasing', 'Leaving'];
const ADV = ['Home', 'Away', 'Alone', 'Again', 'Tonight', 'Slowly', 'Under', 'Forever', 'Back', 'Through'];
const FIRST = ['Mara', 'Jonah', 'Elise', 'Theo', 'Nina', 'Felix', 'Iris', 'Oscar', 'Lena', 'Milo', 'Ada', 'Rufus'];
const LAST = ['Vale', 'Hart', 'Moreno', 'Quinn', 'Sato', 'Okafor', 'Lind', 'Reyes', 'Abbott', 'Novak'];

/** A cover as an inline SVG, so test mode needs no network. Uses only double quotes, which stay encoded. */
function cover(hue: number, shape: number): string {
    const fg = `hsl(${(hue + 160) % 360},60%,82%)`;
    const shapes = [
        `<circle cx="32" cy="32" r="15" fill="${fg}"/>`,
        `<rect x="17" y="17" width="30" height="30" rx="4" fill="${fg}"/>`,
        `<path d="M32 13L51 47H13z" fill="${fg}"/>`
    ];
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" fill="hsl(${hue},50%,45%)"/>${shapes[shape]}</svg>`;
    return 'data:image/svg+xml,' + encodeURIComponent(svg);
}

export function buildLibrary(): MockLibrary {
    const r = seeded(20261016);
    const pick = <T>(a: readonly T[]): T => a[Math.floor(r() * a.length)];
    const date = (fromYear: number) => {
        const from = Date.UTC(fromYear, 0, 1);
        return new Date(from + r() * (Date.UTC(2026, 9, 1) - from)).toISOString();
    };
    const sample = <T>(a: T[], n: number): T[] => {
        const copy = [...a];
        for (let i = copy.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1));[copy[i], copy[j]] = [copy[j], copy[i]]; }
        return copy.slice(0, n);
    };

    const artists = Array.from({ length: 40 }, () =>
        r() < 0.45 ? `The ${pick(ADJ)} ${pick(NOUN)}` : `${pick(FIRST)} ${pick(LAST)}`);
    const albums = Array.from({ length: 160 }, () => ({
        name: r() < 0.8 ? `${pick(ADJ)} ${pick(NOUN)}` : `${pick(NOUN)}, Vol. ${1 + Math.floor(r() * 3)}`,
        artist: pick(artists),
        image: cover(Math.floor(r() * 360), Math.floor(r() * 3))
    }));

    const tracks: SpotifyTrack[] = Array.from({ length: 900 }, (_, i) => {
        const album = pick(albums);
        const id = 'mock' + i.toString(36).padStart(18, '0');
        const name = r() < 0.6 ? `${pick(ADJ)} ${pick(NOUN)}` : `${pick(VERB)} ${pick(ADV)}`;
        const names = r() < 0.15 ? [album.artist, pick(artists)] : [album.artist];
        return {
            id, uri: `spotify:track:${id}`, name, type: 'track',
            duration_ms: Math.round(120000 + r() * 210000),
            artists: [...new Set(names)].map(n => ({ name: n })),
            album: { name: album.name, images: [{ url: album.image, width: 64, height: 64 }] }
        };
    });

    const me = { id: 'testuser', display_name: 'Test User' };
    const entries = (list: SpotifyTrack[]): MockEntry[] => list.map(t => ({ added_at: date(2023), item: t }));
    const playlist = (id: string, name: string, items: MockEntry[], owner = me, collaborative = false): MockPlaylist => ({
        id, name, ownerId: owner.id, ownerName: owner.display_name, collaborative,
        image: cover(Math.floor(r() * 360), Math.floor(r() * 3)), items
    });

    // Edge cases the loader must skip: a duplicate, a local file, a podcast episode, an empty slot.
    const big = entries(sample(tracks, 600));
    big.splice(10, 0, { added_at: date(2024), item: big[3].item });
    big.splice(20, 0, { added_at: date(2024), item: { id: null, uri: 'spotify:local:Me::Home+recording:180', name: 'Home recording', type: 'track', is_local: true, duration_ms: 180000 } });
    big.splice(30, 0, { added_at: date(2024), item: { id: 'mockepisode0001', uri: 'spotify:episode:mockepisode0001', name: 'A podcast episode', type: 'episode', duration_ms: 1800000 } });
    big.splice(40, 0, { added_at: date(2024), item: null });

    const friend = { id: 'friend', display_name: 'Sam' };
    const spotifyUser = { id: 'spotify', display_name: 'Spotify' };

    return {
        me,
        tracks,
        liked: sample(tracks, 250).map(t => ({ added_at: date(2022), track: t })).sort((a, b) => b.added_at.localeCompare(a.added_at)),
        playlists: [
            playlist('mockplroadtrip', 'Road trip', entries(sample(tracks, 45))),
            playlist('mockpllatenight', 'Late night', entries(sample(tracks, 120))),
            playlist('mockpleverything', 'Everything (600 songs)', big),
            playlist('mockplfriends', 'Friends’ mix (collaborative)', entries(sample(tracks, 30)), friend, true),
            playlist('mockpltophits', 'Today’s Top Hits', entries(sample(tracks, 50)), spotifyUser),
            playlist('mockplempty', 'Empty playlist', [])
        ]
    };
}
