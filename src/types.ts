import type { TagFilter, TagKey } from './tags';

/** A song in the loaded playlist or Liked Songs, trimmed to what the app shows. */
export interface Track {
    id: string;
    uri: string;
    name: string;
    artists: string;
    album: string;
    img: string;
    big: string;
    dur: number;
    added: string;
    idx: number;
}

/** A playlist or Liked Songs, as shown on the picker screen. */
export interface Source {
    id: string;
    name: string;
    liked?: boolean;
    img?: string | null;
    total: number | null;
    owner?: string;
    readable: boolean;
    editable: boolean;
    /** Spotify's version ID for the playlist; changes whenever it's edited. */
    snapshot?: string | null;
}

/** What the app remembers about one song: rating (1–5), when it was rated, when it was first played. */
export interface RatingEntry {
    r?: number;
    t?: number;
    p?: number;
    /** Tags (see tags.ts). */
    inst?: boolean;
    hid?: boolean;
}
export type Ratings = Record<string, RatingEntry>;

export type StatusFilter = 'all' | 'unplayed' | 'played';
export type SortKey = 'order' | 'added' | 'title' | 'artist' | 'rdesc' | 'rasc' | 'dur' | 'shuffle';

export interface Filter {
    q: string;
    status: StatusFilter;
    /** '1'–'5' or 'none' for unrated. */
    ratings: Set<string>;
    sort: SortKey;
    /** Tag chips that are switched on, and whether each hides or shows only its songs. */
    tags: Map<TagKey, TagFilter>;
}

export interface Opts {
    skipRated: boolean;
    /** Stop at the end of each unrated song and beep until it's rated. */
    waitForRating: boolean;
    autoAdvance: boolean;
}

export interface PlayerSnapshot {
    id?: string | null;
    uri?: string;
    linked?: string | null;
    paused: boolean;
    pos: number;
    dur: number;
}

/* ---- Spotify Web API shapes (only the fields this app reads) ---- */
export interface Paging<T> {
    items: T[];
    next: string | null;
    total: number;
}
export interface SpotifyImage { url: string; width?: number | null; height?: number | null }
export interface SpotifyTrack {
    id: string | null;
    /** Set when Spotify played a different copy of the song than the one asked for (relinking). */
    linked_from?: { id: string; uri?: string };
    uri: string;
    name: string;
    type?: string;
    is_local?: boolean;
    duration_ms: number;
    artists?: { name: string }[];
    album?: { name: string; images?: SpotifyImage[] };
}
/** Playlist items use `item` since Feb 2026; Liked Songs and older responses use `track`. */
export interface SpotifyListItem {
    added_at?: string;
    item?: SpotifyTrack | null;
    track?: SpotifyTrack | null;
}
export interface SpotifyPlaylist {
    id: string;
    name: string;
    collaborative?: boolean;
    images?: SpotifyImage[] | null;
    owner?: { id: string; display_name?: string };
    items?: { total: number };
    tracks?: { total: number };
    external_urls?: { spotify?: string };
    snapshot_id?: string;
}
export interface SpotifyUser { id: string; display_name?: string }
export interface SpotifyPlaybackState {
    is_playing: boolean;
    progress_ms: number | null;
    device?: { id: string | null };
    item?: (SpotifyTrack & { id: string }) | null;
}
