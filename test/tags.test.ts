import { describe, expect, it } from 'vitest';
import { TAGS, nextTagFilter, tagDef, tagFilterTitle, tagsHtml } from '../src/tags';

describe('TAGS', () => {
    it('gives every tag its own key and hotkey', () => {
        expect(new Set(TAGS.map(t => t.key)).size).toBe(TAGS.length);
        expect(new Set(TAGS.map(t => t.hotkey)).size).toBe(TAGS.length);
    });
    it("doesn't use a hotkey the app already uses", () => {
        const taken = ['0', '1', '2', '3', '4', '5', 'n', 'm', '/', ' '];
        for (const t of TAGS) expect(taken).not.toContain(t.hotkey);
    });
    it('has instrumental on I and hidden on H', () => {
        expect(tagDef('inst').hotkey).toBe('i');
        expect(tagDef('hid').hotkey).toBe('h');
    });
});

describe('nextTagFilter', () => {
    it('cycles off, exclude, only, then off again', () => {
        expect(nextTagFilter(undefined)).toBe('exclude');
        expect(nextTagFilter('exclude')).toBe('only');
        expect(nextTagFilter('only')).toBeUndefined();
    });
});

describe('tagFilterTitle', () => {
    it('says what the chip is doing and what a click will do', () => {
        const t = tagDef('inst');
        expect(tagFilterTitle(t, undefined)).toBe('Click to hide instrumental songs');
        expect(tagFilterTitle(t, 'exclude')).toContain('Hiding instrumental songs');
        expect(tagFilterTitle(t, 'only')).toContain('Showing only instrumental songs');
    });
});

describe('tagsHtml', () => {
    it('shows only the tags a song has, each labelled', () => {
        const div = document.createElement('div');
        div.innerHTML = tagsHtml(k => k === 'hid');
        const tags = [...div.querySelectorAll('.tag')];
        expect(tags).toHaveLength(1);
        expect(tags[0].getAttribute('aria-label')).toBe('Hidden');
    });
    it('shows nothing for a song with no tags', () => {
        expect(tagsHtml(() => false)).toBe('');
    });
});
