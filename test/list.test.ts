import { beforeEach, describe, expect, it, vi } from 'vitest';
import { clickSelect, computeView, reshuffle, resumeTarget, toggleSel } from '../src/list';
import { S, markPlayed, setRating, setTag } from '../src/state';
import { reset, track } from './helpers';

const ids = () => S.view.map(t => t.id);

beforeEach(() => {
    reset([
        track('a', { name: 'Zebra', artists: 'Mia', album: 'Night', dur: 180_000, added: '2025-03-01' }),
        track('b', { name: 'apple', artists: 'Bo', album: 'Day', dur: 240_000, added: '2025-05-01' }),
        track('c', { name: 'Mango', artists: 'Mia', album: 'Dawn', dur: 120_000, added: '2025-01-01' }),
        track('d', { name: 'Kiwi', artists: 'Al', album: 'Dusk', dur: 300_000, added: '2025-04-01' })
    ]);
});

describe('filtering', () => {
    it('shows everything in playlist order by default', () => {
        computeView();
        expect(ids()).toEqual(['a', 'b', 'c', 'd']);
    });
    it('filters by played status', () => {
        markPlayed('a');
        setRating(['c'], 3); // rated counts as played
        S.filter.status = 'unplayed'; computeView();
        expect(ids()).toEqual(['b', 'd']);
        S.filter.status = 'played'; computeView();
        expect(ids()).toEqual(['a', 'c']);
    });
    it('filters by rating, with "none" for unrated, and combines chips', () => {
        setRating(['a'], 1); setRating(['b'], 5);
        S.filter.ratings = new Set(['1', 'none']); computeView();
        expect(ids()).toEqual(['a', 'c', 'd']);
    });
    it('searches title, artist and album, ignoring case', () => {
        S.filter.q = 'APPLE'; computeView(); expect(ids()).toEqual(['b']);
        S.filter.q = 'mia'; computeView(); expect(ids()).toEqual(['a', 'c']);
        S.filter.q = 'dusk'; computeView(); expect(ids()).toEqual(['d']);
    });
    it('shows only, or hides, songs with a tag', () => {
        setTag(['a', 'c'], 'inst', true);
        S.filter.tags.set('inst', 'only'); computeView();
        expect(ids()).toEqual(['a', 'c']);
        S.filter.tags.set('inst', 'exclude'); computeView();
        expect(ids()).toEqual(['b', 'd']);
    });
    it('combines tag chips: excluding two tags hides songs with either', () => {
        setTag(['a'], 'inst', true); setTag(['b'], 'hid', true);
        S.filter.tags.set('inst', 'exclude'); S.filter.tags.set('hid', 'exclude'); computeView();
        expect(ids()).toEqual(['c', 'd']);
    });
});

describe('sorting', () => {
    const sorted = (sort: typeof S.filter.sort) => { S.filter.sort = sort; computeView(); return ids(); };
    it('sorts by title and artist, alphabetically', () => {
        expect(sorted('title')).toEqual(['b', 'd', 'c', 'a']);
        expect(sorted('artist')).toEqual(['d', 'b', 'c', 'a']);
    });
    it('sorts by most recently added and by length', () => {
        expect(sorted('added')).toEqual(['b', 'd', 'a', 'c']);
        expect(sorted('dur')).toEqual(['d', 'b', 'a', 'c']);
    });
    it('sorts by rating either way, with unrated songs last', () => {
        setRating(['a'], 2); setRating(['c'], 5);
        expect(sorted('rdesc')).toEqual(['c', 'a', 'b', 'd']);
        expect(sorted('rasc')).toEqual(['a', 'c', 'b', 'd']);
    });
    it('keeps a random order steady until shuffled again', () => {
        const values = (list: number[]) => { let n = 0; vi.spyOn(Math, 'random').mockImplementation(() => list[n++ % list.length]); };
        values([0.1, 0.2, 0.3, 0.4]);
        reshuffle();
        const first = sorted('shuffle');
        expect([...first].sort()).toEqual(['a', 'b', 'c', 'd']); // every song, once each
        setRating(['a'], 4);
        S.filter.q = 'a'; computeView(); S.filter.q = '';
        expect(sorted('shuffle')).toEqual(first); // rating or filtering doesn't reshuffle
        values([0.4, 0.3, 0.2, 0.1]);
        reshuffle();
        expect(sorted('shuffle')).not.toEqual(first);
    });
});

describe('resumeTarget', () => {
    it('picks the first song not yet played', () => {
        markPlayed('a'); markPlayed('b');
        computeView();
        expect(resumeTarget()?.id).toBe('c');
    });
    it('falls back to the first unrated song once everything has played', () => {
        for (const id of ['a', 'b', 'c', 'd']) markPlayed(id);
        setRating(['a'], 3);
        computeView();
        expect(resumeTarget()?.id).toBe('b');
    });
    it('finds nothing when everything is rated', () => {
        setRating(['a', 'b', 'c', 'd'], 3);
        computeView();
        expect(resumeTarget()).toBeUndefined();
    });
    it('follows the filtered, sorted list', () => {
        S.filter.sort = 'title'; computeView();
        expect(resumeTarget()?.id).toBe('b');
    });
});

describe('selecting by clicking rows', () => {
    const sel = () => [...S.sel].sort();
    beforeEach(() => computeView());

    it('a click selects just that row', () => {
        clickSelect('a', false, false);
        clickSelect('c', false, false);
        expect(sel()).toEqual(['c']);
    });
    it('clicking the only selected row clears it', () => {
        clickSelect('b', false, false);
        clickSelect('b', false, false);
        expect(sel()).toEqual([]);
    });
    it('Ctrl+click adds and removes', () => {
        clickSelect('a', false, false);
        clickSelect('c', true, false);
        expect(sel()).toEqual(['a', 'c']);
        clickSelect('a', true, false);
        expect(sel()).toEqual(['c']);
    });
    it('Shift+click selects a range, replacing the selection', () => {
        clickSelect('d', true, false); // something else selected first
        clickSelect('a', true, false);
        clickSelect('c', false, true);
        expect(sel()).toEqual(['a', 'b', 'c']);
    });
    it('Shift+click again resizes the range from the same starting row', () => {
        clickSelect('a', false, false);
        clickSelect('d', false, true);
        clickSelect('b', false, true);
        expect(sel()).toEqual(['a', 'b']);
    });
    it('Ctrl+Shift+click adds a range to the selection', () => {
        clickSelect('a', false, false);
        clickSelect('c', true, false);
        clickSelect('d', true, true);
        expect(sel()).toEqual(['a', 'c', 'd']);
    });
    it('updates the row highlights and opens the selection bar', () => {
        clickSelect('b', false, false);
        const row = document.querySelector('#list .row[data-id="b"]');
        if (row) expect(row.classList.contains('sel')).toBe(true);
        expect(document.querySelector('#bulk')?.classList.contains('open')).toBe(true);
    });
});

describe('selecting with checkboxes', () => {
    beforeEach(() => computeView());
    it('ticks add one at a time, and Shift ticks a range', () => {
        toggleSel('a', true, false);
        toggleSel('c', true, false);
        expect([...S.sel].sort()).toEqual(['a', 'c']);
        toggleSel('d', true, true);
        expect([...S.sel].sort()).toEqual(['a', 'c', 'd']);
    });
});
