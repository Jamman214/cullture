import { describe, expect, it } from 'vitest';
import { artistDetail, computeStats, darkText, mergeDetails, monthly, rank, ratingColor, treemap } from '../src/stats';
import type { Ratings } from '../src/types';
import { track } from './helpers';

const details = (...ts: ReturnType<typeof track>[]) => new Map(ts.map(t => [t.id, t]));

describe('computeStats', () => {
    const songs = details(
        track('a', { artistList: ['Tyler, The Creator'], artists: 'Tyler, The Creator', album: 'Igor', year: 2019, dur: 60_000 }),
        track('b', { artistList: ['Tyler, The Creator', 'Kali'], album: 'Igor', year: 2019, dur: 120_000 }),
        track('c', { artists: 'Old, Joined', album: 'Past', year: 1975 }),
        track('d', { artistList: ['Kali'], album: 'Solo' }),
        track('u', { artistList: ['Nobody'] })
    );
    const ratings: Ratings = {
        a: { r: 5, t: 1, inst: true }, b: { r: 4, t: 2 }, c: { r: 2 }, d: { r: 3, hid: true },
        u: { p: 1, inst: true }, // played, not rated
        x: { r: 1 } // rated, but no details saved anywhere
    };
    const s = computeStats([...songs.keys(), ...Object.keys(ratings)], songs, ratings);

    it('counts every rated song, with or without details, and each song once', () => {
        expect(s.total).toBe(6);
        expect(s.rated).toBe(5);
        expect(s.dist).toEqual([1, 1, 1, 1, 1]);
        expect(s.avg).toBe(3);
        expect(s.noDetails).toBe(1);
        expect(s.tags).toEqual({ inst: 2, hid: 1 });
    });
    it('counts a song once for each of its artists, keeping commas inside names', () => {
        const by = Object.fromEntries(s.artists.map(a => [a.name, [a.n, a.avg]]));
        expect(by).toEqual({ 'Tyler, The Creator': [2, 4.5], Kali: [2, 3.5], 'Old, Joined': [1, 2] });
        expect(s.artists[0].name).toBe('Tyler, The Creator'); // most songs, then best average
    });
    it('groups albums by name and first artist', () => {
        expect(s.albums.find(a => a.name === 'Igor')).toMatchObject({ by: 'Tyler, The Creator', n: 2, avg: 4.5 });
    });
    it('sums the length of rated songs and splits songs into decades', () => {
        expect(s.ms).toBe(60_000 + 120_000 + 200_000 + 200_000);
        expect(s.decades.map(d => [d.name, d.n, d.avg])).toEqual([['1970', 1, 2], ['2010', 2, 4.5]]);
        expect(s.noYear).toBe(1);
    });
    it('is empty with no ratings', () => {
        const e = computeStats(['a'], songs, {});
        expect([e.rated, e.avg, e.artists.length, e.months.length]).toEqual([0, 0, 0, 0]);
    });
});

describe('mergeDetails', () => {
    it('keeps the first copy of a song and fills in fields only a later copy has', () => {
        const m = mergeDetails([track('a', { name: 'New' }), track('a', { name: 'Old', year: 1999 }), track('b')]);
        expect(m.get('a')).toMatchObject({ name: 'New', year: 1999 });
        expect(m.size).toBe(2);
    });
});

describe('rank', () => {
    const owner = [{ name: 'one', n: 1, avg: 5 }, { name: 'three', n: 3, avg: 5 }, { name: 'fifty', n: 50, avg: 4.7 }];
    const names = (gs: { name: string }[]) => gs.map(g => g.name);
    it('weighted: ranks many highly rated songs above a few perfect ones', () => {
        expect(names(rank(owner, 'weighted', 3.5))).toEqual(['fifty', 'three', 'one']);
    });
    it('weighted: with equal counts the higher average wins; equal scores go to more songs', () => {
        const gs = [{ name: 'a', n: 4, avg: 4 }, { name: 'b', n: 4, avg: 4.5 }, { name: 'c', n: 9, avg: 4 }, { name: 'd', n: 2, avg: 4 }];
        expect(names(rank(gs, 'weighted', 4))).toEqual(['b', 'c', 'a', 'd']);
    });
    it('avg: plain average first, needs 3 rated songs, ties to more songs', () => {
        expect(names(rank(owner, 'avg', 3.5))).toEqual(['three', 'fifty']);
        expect(names(rank([{ name: 'a', n: 3, avg: 4 }, { name: 'b', n: 6, avg: 4 }], 'avg', 3))).toEqual(['b', 'a']);
    });
    it('count: most rated songs first, ties to the higher average', () => {
        expect(names(rank([...owner, { name: 'three-ish', n: 3, avg: 4 }], 'count', 3.5))).toEqual(['fifty', 'three', 'three-ish', 'one']);
    });
    it('keeps the top n and leaves its input alone', () => {
        const gs = [{ name: 'a', n: 1, avg: 4 }, { name: 'b', n: 1, avg: 5 }];
        expect(names(rank(gs, 'weighted', 3, 1))).toEqual(['b']);
        expect(names(gs)).toEqual(['a', 'b']);
    });
});

describe('monthly', () => {
    const at = (y: number, m: number) => new Date(y, m, 15).getTime();
    it('counts per month, with empty months in between', () => {
        expect(monthly([at(2026, 0), at(2026, 0), at(2026, 2)])).toEqual([
            { y: 2026, m: 0, n: 2 }, { y: 2026, m: 1, n: 0 }, { y: 2026, m: 2, n: 1 }
        ]);
    });
    it('keeps the 12 months up to the latest one, across a new year', () => {
        const ms = monthly([at(2024, 5), at(2025, 3), at(2026, 2)]);
        expect(ms).toHaveLength(12);
        expect(ms[0]).toEqual({ y: 2025, m: 3, n: 1 });
        expect(ms[11]).toEqual({ y: 2026, m: 2, n: 1 });
    });
});

describe('artistDetail', () => {
    it("lists the artist's albums by average and songs best first", () => {
        const s = computeStats(['a', 'b', 'c'], details(
            track('a', { artistList: ['K'], album: 'X', name: 'Zed' }),
            track('b', { artistList: ['K', 'L'], album: 'Y', name: 'Alpha' }),
            track('c', { artistList: ['L'], album: 'X' })
        ), { a: { r: 3 }, b: { r: 5 }, c: { r: 1 } });
        const d = artistDetail(s.songs, 'K');
        expect(d.songs.map(x => x.t.name)).toEqual(['Alpha', 'Zed']);
        expect(d.albums.map(a => [a.name, a.avg])).toEqual([['Y', 5], ['X', 3]]);
    });
});

describe('treemap', () => {
    const W = 800, H = 450;
    const cases = [[1], [5, 3, 1], [6, 6, 4, 3, 2, 2, 1], Array.from({ length: 60 }, (_, i) => 1 + ((i * 37) % 23)), [1, 1, 1, 1]];
    it.each(cases.map(c => [c.length, c]))('tiles the box exactly with %i values, areas in proportion, no overlaps', (_, values) => {
        const rects = treemap(values as number[], W, H);
        const total = (values as number[]).reduce((a, b) => a + b, 0);
        expect(rects.map(r => r.i).sort((a, b) => a - b)).toEqual((values as number[]).map((_, i) => i));
        let area = 0;
        for (const r of rects) {
            area += r.w * r.h;
            expect(r.w * r.h).toBeCloseTo(((values as number[])[r.i] / total) * W * H, 6);
            expect(r.x).toBeGreaterThanOrEqual(-1e-9);
            expect(r.y).toBeGreaterThanOrEqual(-1e-9);
            expect(r.x + r.w).toBeLessThanOrEqual(W + 1e-9);
            expect(r.y + r.h).toBeLessThanOrEqual(H + 1e-9);
        }
        expect(area).toBeCloseTo(W * H, 6);
        for (const a of rects) for (const b of rects) {
            if (a === b) continue;
            const ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
            const oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
            expect(ox <= 1e-9 || oy <= 1e-9).toBe(true);
        }
    });
    it('keeps rectangles close to square', () => {
        const rects = treemap([1, 1, 1, 1], 400, 400);
        for (const r of rects) expect(r.w).toBeCloseTo(200);
    });
    it('skips zero values and copes with nothing to draw', () => {
        expect(treemap([3, 0], 10, 10).map(r => r.i)).toEqual([0]);
        expect(treemap([], 10, 10)).toEqual([]);
    });
});

describe('rating colours', () => {
    const stops = ['#000000', '#404040', '#808080', '#c0c0c0', '#ffffff'];
    it('blends between neighbouring rating colours', () => {
        expect(ratingColor(stops, 1)).toEqual([0, 0, 0]);
        expect(ratingColor(stops, 5)).toEqual([255, 255, 255]);
        expect(ratingColor(stops, 2.5)).toEqual([96, 96, 96]);
        expect(ratingColor(stops, 9)).toEqual([255, 255, 255]);
    });
    it('picks dark text on light fills and white on dark ones', () => {
        expect(darkText([242, 201, 76])).toBe(true); // dark theme's 3★ yellow
        expect(darkText([217, 71, 75])).toBe(false); // light theme's 1★ red
        expect(darkText([0, 0, 0])).toBe(false);
    });
});
