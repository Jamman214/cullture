import { beforeEach, describe, expect, it } from 'vitest';
import { cacheMeta, isStale } from '../src/cache';
import { KEY } from '../src/config';
import type { Source } from '../src/types';
import { LS } from '../src/util';

const saved = (id: string, meta: { snapshot?: string | null; total?: number | null }) =>
    LS.set(KEY.cache(id), { savedAt: 1, count: 10, snapshot: null, total: null, ...meta });

const src = (over: Partial<Source>): Source => ({ id: 'pl', name: 'x', total: 10, readable: true, editable: true, ...over });

beforeEach(() => localStorage.clear());

describe('isStale (has the playlist changed on Spotify since it was saved?)', () => {
    it('is false when nothing is saved', () => {
        expect(cacheMeta('pl')).toBeNull();
        expect(isStale(src({ snapshot: 'v2' }))).toBe(false);
    });
    it("compares a playlist's version ID", () => {
        saved('pl', { snapshot: 'v1' });
        expect(isStale(src({ snapshot: 'v1' }))).toBe(false);
        expect(isStale(src({ snapshot: 'v2' }))).toBe(true);
    });
    it("can't tell when a version ID is missing, so says no", () => {
        saved('pl', { snapshot: null });
        expect(isStale(src({ snapshot: 'v2' }))).toBe(false);
    });
    it('compares the song count for Liked Songs, which has no version ID', () => {
        saved('liked', { total: 250 });
        expect(isStale(src({ id: 'liked', liked: true, total: 250 }))).toBe(false);
        expect(isStale(src({ id: 'liked', liked: true, total: 249 }))).toBe(true);
    });
});
