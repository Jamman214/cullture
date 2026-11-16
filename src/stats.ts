/**
 * Rating statistics for the stats screen: pure functions over songs and ratings, with no DOM
 * and no app state. dashboard.ts loads the data and draws what these return.
 */
import { TAGS, type TagKey } from './tags';
import type { Ratings, Track } from './types';

/** An artist, album or decade: how many rated songs it has and their average rating. */
export interface Group { name: string; by?: string; n: number; avg: number }
/** A rated song with saved details. */
export interface Song { t: Track; r: number }
export interface Month { y: number; m: number; n: number }

export interface Stats {
    /** Songs in scope, and how many of them are rated. */
    total: number;
    rated: number;
    avg: number;
    /** Rated songs per star, 1★ first. */
    dist: number[];
    tags: Record<TagKey, number>;
    songs: Song[];
    /** Rated songs with no saved details, left out of everything that needs them. */
    noDetails: number;
    /** Total length of the rated songs with details. */
    ms: number;
    artists: Group[];
    albums: Group[];
    /** Decades named by first year ('1970'), oldest first; rated songs with details but no year. */
    decades: Group[];
    noYear: number;
    months: Month[];
}

// shortcut: songs saved before artistList existed count under their joined name ("A, B"), fixed by reloading the playlist
export const artistsOf = (t: Track): string[] => t.artistList ?? [t.artists];

/** One map of song details by ID; the first copy of a song wins, and later copies fill in fields it lacks (e.g. year). */
export function mergeDetails(tracks: Track[]): Map<string, Track> {
    const m = new Map<string, Track>();
    for (const t of tracks) m.set(t.id, { ...t, ...m.get(t.id) });
    return m;
}

/** Groups songs by key (a song can count under several), most songs first. A key 'name\nby' sets `by`. */
function groups(songs: Song[], keys: (t: Track) => string[]): Group[] {
    const m = new Map<string, { n: number; sum: number }>();
    for (const { t, r } of songs) {
        for (const k of new Set(keys(t))) {
            const g = m.get(k) ?? { n: 0, sum: 0 };
            g.n++;
            g.sum += r;
            m.set(k, g);
        }
    }
    return [...m].map(([k, g]): Group => {
        const [name, by] = k.split('\n');
        return by ? { name, by, n: g.n, avg: g.sum / g.n } : { name, n: g.n, avg: g.sum / g.n };
    }).sort((a, b) => b.n - a.n || b.avg - a.avg || a.name.localeCompare(b.name));
}

// shortcut: Track has no album ID, so an album is its name plus first artist; two same-named albums by one artist merge
const albumKey = (t: Track) => (t.album ? [`${t.album}\n${artistsOf(t)[0]}`] : []);

/** Stats for the songs `ids`, using `details` for whatever needs a song's name, artists, album, length or year. */
export function computeStats(ids: Iterable<string>, details: Map<string, Track>, ratings: Ratings): Stats {
    const dist = [0, 0, 0, 0, 0];
    const tags = Object.fromEntries(TAGS.map(t => [t.key, 0])) as Record<TagKey, number>;
    const songs: Song[] = [];
    const times: number[] = [];
    let total = 0, sum = 0, noDetails = 0;
    for (const id of new Set(ids)) {
        total++;
        const e = ratings[id];
        for (const tg of TAGS) if (e?.[tg.key]) tags[tg.key]++;
        if (!e?.r) continue;
        dist[e.r - 1]++;
        sum += e.r;
        if (e.t) times.push(e.t);
        const t = details.get(id);
        if (t) songs.push({ t, r: e.r }); else noDetails++;
    }
    const rated = dist.reduce((a, b) => a + b, 0);
    const dated = songs.filter(s => s.t.year);
    return {
        total, rated, avg: rated ? sum / rated : 0, dist, tags, songs, noDetails,
        ms: songs.reduce((a, s) => a + (s.t.dur || 0), 0),
        artists: groups(songs, artistsOf),
        albums: groups(songs, albumKey),
        decades: groups(dated, t => [String(Math.floor(t.year! / 10) * 10)]).sort((a, b) => Number(a.name) - Number(b.name)),
        noYear: songs.length - dated.length,
        months: monthly(times)
    };
}

export type RankBy = 'weighted' | 'avg' | 'count';

/**
 * The top `n` groups by `by`:
 * - weighted: Bayesian average, each group getting 5 extra songs rated `mean` (the scope's
 *   average), so a few perfect songs don't outrank many highly rated ones; ties to more songs.
 * - avg: plain average, only groups with 3 or more rated songs; ties to more songs.
 * - count: most rated songs; ties to the higher average.
 */
export function rank(gs: Group[], by: RankBy, mean: number, n = 10): Group[] {
    const M = 5;
    const score = (g: Group) => (by === 'weighted' ? (g.n * g.avg + M * mean) / (g.n + M) : by === 'avg' ? g.avg : g.n);
    const tie = (a: Group, b: Group) => (by === 'count' ? b.avg - a.avg : b.n - a.n);
    return gs.filter(g => by !== 'avg' || g.n >= 3)
        .sort((a, b) => score(b) - score(a) || tie(a, b) || a.name.localeCompare(b.name)).slice(0, n);
}

/** Songs rated per calendar month (local time): up to `max` months ending with the latest one that has any. */
export function monthly(times: number[], max = 12): Month[] {
    if (!times.length) return [];
    const counts = new Map<number, number>();
    for (const t of times) {
        const d = new Date(t);
        const k = d.getFullYear() * 12 + d.getMonth();
        counts.set(k, (counts.get(k) ?? 0) + 1);
    }
    const keys = [...counts.keys()];
    const last = Math.max(...keys);
    const first = Math.max(Math.min(...keys), last - max + 1);
    return Array.from({ length: last - first + 1 }, (_, i) => ({ y: Math.floor((first + i) / 12), m: (first + i) % 12, n: counts.get(first + i) ?? 0 }));
}

/** One artist's albums (best average first) and rated songs (best first). */
export function artistDetail(songs: Song[], name: string): { albums: Group[]; songs: Song[] } {
    const mine = songs.filter(s => artistsOf(s.t).includes(name));
    return {
        albums: groups(mine, t => (t.album ? [t.album] : [])).sort((a, b) => b.avg - a.avg || b.n - a.n),
        songs: mine.sort((a, b) => b.r - a.r || a.t.name.localeCompare(b.t.name))
    };
}

export interface Rect { i: number; x: number; y: number; w: number; h: number }

/**
 * Squarified treemap (Bruls, Huizing and van Wijk): tiles a w×h box with one rectangle per
 * positive value, `i` being its index in `values`, area proportional to value, kept close to square.
 */
export function treemap(values: number[], w: number, h: number): Rect[] {
    const total = values.reduce((a, v) => a + Math.max(0, v), 0);
    const out: Rect[] = [];
    if (!total || w <= 0 || h <= 0) return out;
    const items = values.map((v, i) => ({ i, a: (v * w * h) / total })).filter(d => d.a > 0).sort((p, q) => q.a - p.a);
    let x = 0, y = 0;
    // How far the row's worst rectangle is from square, laid along a side of this length.
    const worst = (row: typeof items, side: number) => {
        const s = row.reduce((a, d) => a + d.a, 0);
        return Math.max((side * side * row[0].a) / (s * s), (s * s) / (side * side * row[row.length - 1].a));
    };
    const place = (row: typeof items, last: boolean) => {
        const s = row.reduce((a, d) => a + d.a, 0);
        const wide = w >= h;
        const thick = last ? (wide ? w : h) : s / (wide ? h : w);
        let at = wide ? y : x;
        row.forEach((d, k) => {
            // The last rectangle runs to the edge, so rounding never leaves a gap.
            const len = k === row.length - 1 ? (wide ? y + h : x + w) - at : d.a / thick;
            out.push(wide ? { i: d.i, x, y: at, w: thick, h: len } : { i: d.i, x: at, y, w: len, h: thick });
            at += len;
        });
        if (wide) { x += thick; w -= thick; } else { y += thick; h -= thick; }
    };
    let row: typeof items = [];
    for (const d of items) {
        const side = Math.min(w, h);
        if (row.length && worst([...row, d], side) > worst(row, side)) { place(row, false); row = []; }
        row.push(d);
    }
    place(row, true);
    return out;
}

/** A colour on the rating scale for an average from 1 to 5, blending between the five rating colours (#rrggbb). */
export function ratingColor(stops: string[], avg: number): [number, number, number] {
    const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.trim().slice(i, i + 2), 16));
    const x = Math.min(4, Math.max(0, avg - 1));
    const i = Math.min(3, Math.floor(x));
    const a = rgb(stops[i]), b = rgb(stops[i + 1]);
    return a.map((v, k) => Math.round(v + (b[k] - v) * (x - i))) as [number, number, number];
}

/** True when near-black text has more contrast than white on this background (WCAG relative luminance). */
export function darkText([r, g, b]: [number, number, number]): boolean {
    const lin = (c: number) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
    const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
    return (L + 0.05) / 0.06 > 1.05 / (L + 0.05); // 0.06 ≈ luminance of #1D1A2C plus 0.05
}

/**
 * An artist's best album (highest average among their rated songs, ties to more songs) and
 * artwork to stand in for the artist, who has no photo saved: that album's cover, else any of
 * their songs' cover, else ''.
 */
export function artistCover(songs: Song[], name: string): { album: string; img: string; big: string } {
    const d = artistDetail(songs, name);
    const album = d.albums[0]?.name ?? '';
    const art = (s: Song) => !!(s.t.img || s.t.big);
    const t = (d.songs.find(s => s.t.album === album && art(s)) ?? d.songs.find(art))?.t;
    return { album, img: t?.img || t?.big || '', big: t?.big || t?.img || '' };
}

/**
 * What a w×h px treemap tile has room for, and where: at 13px the name top left with the rating in the
 * bottom-right corner, either below the name ('stack') or on the same line, the name cut short before it ('row');
 * else only the rating in that corner ('corner'), as large as fits up to 13px and no smaller than 8px;
 * else the rating filling the tile ('fit'), as "4.2", then the rounded "4"; null when nothing fits.
 * The em widths are rough bold glyph widths plus the pill's padding, less of it when filling the tile.
 */
export function tileLabel(w: number, h: number, avg: number): { pos: 'stack' | 'row' | 'corner' | 'fit'; text: string; px: number } | null {
    const a = avg.toFixed(1);
    if (w >= 64 && h >= 44) return { pos: 'stack', text: a, px: 13 };
    if (w >= 84 && h >= 26) return { pos: 'row', text: a, px: 13 };
    // [where, text, px of inset, em wide]
    for (const [pos, text, inset, em] of [['corner', a, 8, 2.3], ['fit', a, 2, 1.9], ['fit', String(Math.round(avg)), 2, .9]] as const) {
        const px = Math.floor(Math.min(13, (w - inset) / em, (h - inset) / 1.4));
        if (px >= 8) return { pos, text, px };
    }
    return null;
}

/** Spotify artist ID by artist name: a name seen with an ID on any song gets it (the first one seen). */
export function artistIdsByName(songs: Song[]): Map<string, string> {
    const m = new Map<string, string>();
    for (const { t } of songs) t.artistIds?.forEach((id, k) => { const n = t.artistList?.[k]; if (id && n && !m.has(n)) m.set(n, id); });
    return m;
}
