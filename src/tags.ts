/**
 * Song tags: marks you set by hand, like instrumental or private. Each one is a key press
 * while a song plays, a toggle in the selection bar, a filter chip, and an icon next to the
 * title. To add a tag, add it to TAGS and to TagKey; everything else picks it up.
 */
import { esc } from './util';

export type TagKey = 'inst' | 'hid';

/** How a tag chip filters the list: hide songs with the tag, or show only those. */
export type TagFilter = 'exclude' | 'only';

export interface TagDef {
    key: TagKey;
    label: string;
    /** Lowercase key that toggles the tag on the playing song. */
    hotkey: string;
    icon: string;
}

const svg = (body: string) => `<svg class="tag-icon" viewBox="0 0 24 24" aria-hidden="true">${body}</svg>`;

export const TAGS: TagDef[] = [
    {
        key: 'inst', label: 'Instrumental', hotkey: 'i',
        icon: svg('<path fill="currentColor" d="M9 17.5V6.2l10-2.2v11.3a2.6 2.6 0 1 1-1.6-2.4V7.1L10.6 8.6v9.1A2.6 2.6 0 1 1 9 17.5z"/>')
    },
    {
        key: 'hid', label: 'Hidden', hotkey: 'h',
        icon: svg('<path fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" d="M3 3l18 18M10.6 5.1A10.4 10.4 0 0 1 12 5c5.5 0 9 5 9.8 7a14 14 0 0 1-3 4.1M6.6 6.6C4.5 8 3 10.2 2.2 12c.8 2 4.3 7 9.8 7a9.9 9.9 0 0 0 4.4-1M9.9 9.9a3 3 0 0 0 4.2 4.2"/>')
    }
];

export const tagDef = (key: TagKey) => TAGS.find(t => t.key === key)!;

/** The icon-only tags a song has, for its row and the player bar. */
export function tagsHtml(has: (key: TagKey) => boolean): string {
    return TAGS.filter(t => has(t.key))
        .map(t => `<span class="tag" title="${esc(t.label)}" aria-label="${esc(t.label)}">${t.icon}</span>`).join('');
}

/** What clicking a tag chip does next: off, then exclude, then only, then off again. */
export const nextTagFilter = (f: TagFilter | undefined): TagFilter | undefined =>
    f === undefined ? 'exclude' : f === 'exclude' ? 'only' : undefined;

/** Tooltip for a tag chip: what it's doing now, and what a click does. */
export function tagFilterTitle(t: TagDef, f: TagFilter | undefined): string {
    const name = t.label.toLowerCase();
    if (f === 'exclude') return `Hiding ${name} songs. Click to show only ${name} songs`;
    if (f === 'only') return `Showing only ${name} songs. Click to show all songs`;
    return `Click to hide ${name} songs`;
}