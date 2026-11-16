import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/api', async importOriginal => ({ ...(await importOriginal<typeof import('../src/api')>()), api: vi.fn() }));
import { api } from '../src/api';
import { KEY } from '../src/config';
import { importRatings, removeTracks, saveKeepers } from '../src/cull';
import { S, hasTag, playedOf, rOf, setRating } from '../src/state';
import { playlist, reset, track } from './helpers';

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
    it('ignores ratings that are not whole numbers', async () => {
        await importRatings(file({ ratings: { a: { r: 4.5, t: 1 } } }));
        expect(S.ratings.a).toBeUndefined();
    });
    it("doesn't add or count songs that bring nothing in", async () => {
        await importRatings(file({ ratings: { a: { r: 9 }, b: { r: 3, t: 1 } } }));
        expect(Object.keys(S.ratings)).toEqual(['b']);
        expect(document.querySelector('#toast')?.textContent).toMatch(/for 1 song\./);
    });
    it('rejects a list instead of an export', async () => {
        await importRatings(file([{ r: 3 }]));
        expect(S.ratings).toEqual({});
        expect(document.querySelector('#toast')?.textContent).toMatch(/isn.t a Cullture ratings export/);
    });
    it('says so, and changes nothing, for a file that is not an export', async () => {
        await importRatings(file('not json'));
        expect(S.ratings).toEqual({});
        expect(document.querySelector('#toast')?.textContent).toMatch(/isn.t a Cullture ratings export/);
    });
});

describe('removeTracks', () => {
    // jsdom has no modal dialogs.
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) { this.open = true; };
    HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) { this.open = false; };

    it("leaves another playlist alone if it was opened while songs were being removed", async () => {
        const other = [track('x'), track('y')];
        reset([track('a'), track('b')]);
        const src = S.source!;
        localStorage.setItem(KEY.cache(src.id), '{}');
        vi.mocked(api).mockImplementation(async () => {
            S.source = { ...playlist, id: 'other' };
            S.tracks = other;
            return { snapshot_id: 'v2' } as never;
        });
        const done = removeTracks(['a']);
        document.querySelector<HTMLButtonElement>('#cfYes')!.click();
        await done;
        expect(S.tracks).toBe(other);
        expect(localStorage.getItem(KEY.cache(src.id))).toBeNull();
        expect(src.total).toBe(1);
        expect(document.querySelector('#toast')?.textContent).toMatch(/Removed 1 song/);
    });
});

describe('saveKeepers', () => {
    it('keeps a playlist that was created even if adding songs stopped part-way, and says how many got in', async () => {
        reset(Array.from({ length: 12 }, (_, i) => track(`k${i}`)));
        setRating(S.tracks.map(t => t.id), 5);
        S.me = { id: 'me' };
        S.sources = [];
        document.querySelector<HTMLInputElement>('#keepName')!.value = 'Keepers';
        let batches = 0;
        vi.mocked(api).mockImplementation(async path => {
            if (path === '/me/playlists') return { id: 'new', name: 'Keepers', external_urls: { spotify: 'https://open.spotify.com/playlist/new' } } as never;
            if (++batches > 1) throw new Error('Server error');
            return null as never;
        });
        await saveKeepers();
        expect(S.sources[0]).toMatchObject({ id: 'new', total: 10 });
        expect(document.querySelector('#toast')?.textContent).toMatch(/Created “Keepers” but only 10 of 12 songs were added: Server error/);
        expect(document.querySelector('#toast a')?.getAttribute('href')).toBe('https://open.spotify.com/playlist/new');
    });
});
