import { afterEach, describe, expect, it, vi } from 'vitest';
import { ago, chunk, esc, fmt, plural, starsHtml } from '../src/util';

describe('esc', () => {
    it('escapes characters that would break HTML', () => {
        expect(esc(`<b class="x">Tom & Jerry's</b>`)).toBe('&lt;b class=&quot;x&quot;&gt;Tom &amp; Jerry&#39;s&lt;/b&gt;');
    });
    it('turns null and undefined into an empty string', () => {
        expect(esc(null)).toBe('');
        expect(esc(undefined)).toBe('');
    });
});

describe('fmt', () => {
    it('formats milliseconds as minutes:seconds', () => {
        expect(fmt(0)).toBe('0:00');
        expect(fmt(61_000)).toBe('1:01');
        expect(fmt(3_599_000)).toBe('59:59');
    });
    it('rounds down and never goes negative', () => {
        expect(fmt(1_999)).toBe('0:01');
        expect(fmt(-5_000)).toBe('0:00');
    });
});

describe('chunk', () => {
    it('splits a list into batches, the last one shorter', () => {
        expect(chunk([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
        expect(chunk([], 3)).toEqual([]);
    });
});

describe('plural', () => {
    it('adds an s except for one', () => {
        expect(plural(1, 'song')).toBe('1 song');
        expect(plural(0, 'song')).toBe('0 songs');
        expect(plural(3, 'song')).toBe('3 songs');
    });
});

describe('ago', () => {
    afterEach(() => { vi.useRealTimers(); });
    it('describes how long ago a time was', () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date('2026-01-10T12:00:00Z'));
        const now = Date.now();
        expect(ago(now - 10_000)).toBe('just now');
        expect(ago(now - 5 * 60_000)).toBe('5 min ago');
        expect(ago(now - 3 * 3_600_000)).toBe('3 hours ago');
        expect(ago(now - 2 * 86_400_000)).toBe('2 days ago');
    });
});

describe('starsHtml', () => {
    const stars = (html: string) => {
        const div = document.createElement('div');
        div.innerHTML = html;
        return [...div.querySelectorAll<HTMLElement>('.star')];
    };
    it('makes five stars, highest first, so CSS can light up lower stars on hover', () => {
        expect(stars(starsHtml(0)).map(s => s.dataset.v)).toEqual(['5', '4', '3', '2', '1']);
    });
    it('marks the stars up to the rating as on', () => {
        const on = stars(starsHtml(3)).filter(s => s.classList.contains('on')).map(s => s.dataset.v);
        expect(on.sort()).toEqual(['1', '2', '3']);
    });
    it('labels every star for screen readers', () => {
        expect(stars(starsHtml(0)).map(s => s.getAttribute('aria-label'))).toContain('Rate 1 star');
    });
});
