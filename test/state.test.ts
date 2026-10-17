import { beforeEach, describe, expect, it } from 'vitest';
import { S, hasTag, markPlayed, playedOf, rOf, setRating, setTag, setTracks } from '../src/state';
import { reset, track } from './helpers';

beforeEach(() => reset());

describe('ratings', () => {
    it('saves a rating and when it was given', () => {
        setRating(['a'], 4);
        expect(rOf('a')).toBe(4);
        expect(S.ratings.a.t).toBeTypeOf('number');
    });
    it('rates several songs at once', () => {
        setRating(['a', 'b'], 2);
        expect([rOf('a'), rOf('b')]).toEqual([2, 2]);
    });
    it('clearing a rating removes the entry when nothing else is stored', () => {
        setRating(['a'], 3);
        setRating(['a'], null);
        expect(S.ratings.a).toBeUndefined();
    });
    it('clearing a rating keeps the play history', () => {
        markPlayed('a');
        setRating(['a'], 3);
        setRating(['a'], null);
        expect(rOf('a')).toBe(0);
        expect(playedOf('a')).toBe(true);
    });
    it('clearing a rating keeps tags', () => {
        setTag(['a'], 'inst', true);
        setRating(['a'], 5);
        setRating(['a'], null);
        expect(hasTag('a', 'inst')).toBe(true);
    });
    it('treats unknown songs as unrated and unplayed', () => {
        expect(rOf('nope')).toBe(0);
        expect(rOf(null)).toBe(0);
        expect(playedOf('nope')).toBe(false);
    });
});

describe('play history', () => {
    it('reports a first play once, so the summary only updates when it changes', () => {
        expect(markPlayed('a')).toBe(true);
        expect(markPlayed('a')).toBe(false);
    });
    it('counts a rated song as played, even if it never played', () => {
        setRating(['a'], 1);
        expect(playedOf('a')).toBe(true);
    });
});

describe('tags', () => {
    it('adds and removes a tag', () => {
        setTag(['a', 'b'], 'hid', true);
        expect([hasTag('a', 'hid'), hasTag('b', 'hid')]).toEqual([true, true]);
        setTag(['a'], 'hid', false);
        expect(hasTag('a', 'hid')).toBe(false);
    });
    it('keeps tags separate from each other', () => {
        setTag(['a'], 'inst', true);
        expect(hasTag('a', 'hid')).toBe(false);
    });
    it('removes the entry once the last thing in it goes', () => {
        setTag(['a'], 'inst', true);
        setTag(['a'], 'inst', false);
        expect(S.ratings.a).toBeUndefined();
    });
});

describe('setTracks', () => {
    it('numbers songs in order and indexes them by ID', () => {
        setTracks([track('x'), track('y')]);
        expect(S.tracks.map(t => t.idx)).toEqual([0, 1]);
        expect(S.byId.get('y')?.name).toBe('Song y');
    });
    it('drops selected songs that are no longer in the list', () => {
        setTracks([track('x'), track('y')]);
        S.sel = new Set(['x', 'y']);
        setTracks([track('y')]);
        expect([...S.sel]).toEqual(['y']);
    });
});
