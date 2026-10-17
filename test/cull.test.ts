import { beforeEach, describe, expect, it } from 'vitest';
import { importRatings } from '../src/cull';
import { S, hasTag, playedOf, rOf, setRating } from '../src/state';
import { reset } from './helpers';

/** A stand-in for a chosen file. jsdom's File can't be read with .text(), and that's all importRatings uses. */
const file = (data: unknown) => {
    const text = typeof data === 'string' ? data : JSON.stringify(data);
    return { name: 'ratings.json', text: async () => text } as unknown as File;
};

beforeEach(() => { reset(); S.source = null; });

describe('importRatings', () => {
    it('brings in ratings, plays and tags from an export', async () => {
        await importRatings(file({ app: 'cullture', ratings: { a: { r: 4, t: 10, p: 5, inst: true } } }));
        expect(rOf('a')).toBe(4);
        expect(playedOf('a')).toBe(true);
        expect(hasTag('a', 'inst')).toBe(true);
    });
    it('keeps the more recent rating when both have one', async () => {
        setRating(['a'], 2);
        const mine = S.ratings.a.t!;
        await importRatings(file({ ratings: { a: { r: 5, t: mine - 1000 } } }));
        expect(rOf('a')).toBe(2);
        await importRatings(file({ ratings: { a: { r: 5, t: mine + 1000 } } }));
        expect(rOf('a')).toBe(5);
    });
    it('adds tags without removing ones already set', async () => {
        S.ratings.a = { hid: true };
        await importRatings(file({ ratings: { a: { inst: true } } }));
        expect([hasTag('a', 'inst'), hasTag('a', 'hid')]).toEqual([true, true]);
    });
    it('ignores ratings outside 1 to 5', async () => {
        await importRatings(file({ ratings: { a: { r: 9, t: 1 } } }));
        expect(rOf('a')).toBe(0);
    });
    it('says so, and changes nothing, for a file that is not an export', async () => {
        await importRatings(file('not json'));
        expect(S.ratings).toEqual({});
        expect(document.querySelector('#toast')?.textContent).toMatch(/isn.t a Cullture ratings export/);
    });
});
