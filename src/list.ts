/** The song list: filtering, sorting, rendering, selection and the progress summary. */
import { KEY } from './config';
import { S, hasTag, playedOf, rOf } from './state';
import { TAGS, tagFilterTitle, type TagKey, tagsHtml } from './tags';
import type { SortKey, Track } from './types';
import { $, LS, PLAY_SVG, esc, fmt, plural, starsHtml } from './util';

/**
 * Each song's random position for "Random order". Kept until reshuffle(), so the order
 * stays put while you rate songs or change filters.
 */
const shuffleKeys = new Map<string, number>();
export function reshuffle(): void { shuffleKeys.clear(); }
function shuffleKey(id: string): number {
    let k = shuffleKeys.get(id);
    if (k === undefined) { k = Math.random(); shuffleKeys.set(id, k); }
    return k;
}

export function computeView(): void {
    const { q, status, ratings, sort } = S.filter;
    const qq = q.trim().toLowerCase();
    const v = S.tracks.filter(t => {
        const r = rOf(t.id);
        const played = playedOf(t.id);
        if (status === 'unplayed' && played) return false;
        if (status === 'played' && !played) return false;
        if (ratings.size && !ratings.has(r ? String(r) : 'none')) return false;
        for (const [tag, f] of S.filter.tags) {
            if (f === 'only' && !hasTag(t.id, tag)) return false;
            if (f === 'exclude' && hasTag(t.id, tag)) return false;
        }
        if (qq && !`${t.name} ${t.artists} ${t.album}`.toLowerCase().includes(qq)) return false;
        return true;
    });
    const cmp: Record<SortKey, (a: Track, b: Track) => number> = {
        order: (a, b) => a.idx - b.idx,
        added: (a, b) => (b.added || '').localeCompare(a.added || ''),
        title: (a, b) => a.name.localeCompare(b.name),
        artist: (a, b) => a.artists.localeCompare(b.artists) || a.name.localeCompare(b.name),
        rdesc: (a, b) => (rOf(b.id) || -1) - (rOf(a.id) || -1) || a.idx - b.idx,
        rasc: (a, b) => (rOf(a.id) || 9) - (rOf(b.id) || 9) || a.idx - b.idx,
        dur: (a, b) => b.dur - a.dur,
        shuffle: (a, b) => shuffleKey(a.id) - shuffleKey(b.id)
    };
    S.view = v.sort(cmp[sort]);
}

export function rowHtml(t: Track): string {
    const r = rOf(t.id);
    const played = playedOf(t.id);
    const sel = S.sel.has(t.id);
    return `<div class="row${sel ? ' sel' : ''}${S.pb.cur === t.id ? ' cur' : ''}" data-id="${t.id}">
<input type="checkbox" class="ck" ${sel ? 'checked' : ''} aria-label="Select ${esc(t.name)}">
<span class="n">${t.idx + 1}</span>
<img loading="lazy" src="${esc(t.img)}" alt="">
<div class="ti"><span class="nm-line"><span class="nm">${esc(t.name)}</span>${tagsHtml(k => hasTag(t.id, k))}</span><span class="ar">${esc(t.artists)}</span></div>
<span class="al">${esc(t.album)}</span>
<span class="pl${played ? ' on' : ''}" title="${played ? 'Played' : 'Not played yet'}"></span>
<span class="du">${fmt(t.dur)}</span>
<div class="stars" data-r="${r}">${starsHtml(r)}</div>
<button class="pbtn" aria-label="Play ${esc(t.name)}">${PLAY_SVG}</button></div>`;
}

export function renderList(): void {
    computeView();
    const list = $('#list');
    if (!S.tracks.length) list.innerHTML = '<div class="empty">This list has no playable songs.</div>';
    else if (!S.view.length) list.innerHTML = '<div class="empty">No songs match these filters. <button class="btn" id="clearF">Clear filters</button></div>';
    else list.innerHTML = S.view.map(rowHtml).join('');
    list.querySelector('#clearF')?.addEventListener('click', clearFilters);
    renderSummary();
    renderBulk();
    renderFilters();
}

/** Re-renders one row in place, so rating a song doesn't reshuffle the list under the cursor. */
export function updateRow(id: string | null): void {
    if (!id) return;
    const el = $('#list').querySelector(`.row[data-id="${id}"]`);
    const t = S.byId.get(id);
    if (el && t) el.outerHTML = rowHtml(t);
}

export function rowEl(id: string): HTMLElement | null {
    return $('#list').querySelector<HTMLElement>(`.row[data-id="${id}"]`);
}

export function syncSelDom(): void {
    $('#list').querySelectorAll<HTMLElement>('.row').forEach(r => {
        const s = S.sel.has(r.dataset.id ?? '');
        r.classList.toggle('sel', s);
        $<HTMLInputElement>('.ck', r).checked = s;
    });
    renderBulk();
}

export function clearFilters(): void {
    S.filter.q = '';
    S.filter.status = 'all';
    S.filter.ratings.clear();
    S.filter.tags.clear();
    $<HTMLInputElement>('#q').value = '';
    renderList();
}

export const CATS = [
    { k: '5', label: '5 stars', c: 'var(--r5)' },
    { k: '4', label: '4 stars', c: 'var(--r4)' },
    { k: '3', label: '3 stars', c: 'var(--r3)' },
    { k: '2', label: '2 stars', c: 'var(--r2)' },
    { k: '1', label: '1 star', c: 'var(--r1)' },
    { k: 'heard', label: 'Played, not rated', c: 'var(--heard)' },
    { k: 'none', label: 'Not played', c: 'var(--unheard)' }
] as const;
type CatKey = (typeof CATS)[number]['k'];

function counts(): Record<CatKey, number> {
    const c: Record<CatKey, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, heard: 0, none: 0 };
    for (const t of S.tracks) {
        const r = rOf(t.id);
        if (r) c[String(r) as CatKey]++;
        else if (playedOf(t.id)) c.heard++;
        else c.none++;
    }
    return c;
}

/** First song not played yet in the current view, else the first unrated one. */
export function resumeTarget(): Track | undefined {
    const v = S.view.length ? S.view : S.tracks;
    return v.find(t => !playedOf(t.id)) || v.find(t => !rOf(t.id));
}

export function renderSummary(): void {
    if (!S.source) return;
    const c = counts();
    const total = S.tracks.length;
    const rated = c[1] + c[2] + c[3] + c[4] + c[5];
    const tagged = TAGS.map(tg => [tg.label.toLowerCase(), S.tracks.filter(t => hasTag(t.id, tg.key)).length] as const)
        .filter(([, n]) => n).map(([label, n]) => `${n} ${label}`);
    $('#sumLine').textContent = total
        ? `${rated} of ${plural(total, 'song')} rated. ${c.heard} played but not rated, ${c.none} not played yet.${tagged.length ? ` ${tagged.join(', ')}.` : ''}`
        : '';
    $('#bar').innerHTML = total
        ? CATS.filter(k => c[k.k]).map(k =>
            `<button style="width:${(c[k.k] / total) * 100}%;background:${k.c}" data-k="${k.k}" title="${k.label}: ${c[k.k]}" aria-label="Filter: ${k.label} (${c[k.k]})"></button>`).join('')
        : '';
    $('#legend').innerHTML = CATS.map(k => `<span style="--c:${k.c}">${k.label} ${c[k.k]}</span>`).join('');

    const target = resumeTarget();
    const rb = $<HTMLButtonElement>('#resumeBtn');
    rb.disabled = !target;
    rb.textContent = !target ? 'Everything played' : c.none === total ? 'Start rating' : `Resume at #${target.idx + 1}`;
    LS.set(KEY.progress(S.source.id), { total, rated });
}

const CHIPS: [string, string, string][] = [
    ['none', 'Unrated', 'var(--unheard)'], ['1', '1★', 'var(--r1)'], ['2', '2★', 'var(--r2)'],
    ['3', '3★', 'var(--r3)'], ['4', '4★', 'var(--r4)'], ['5', '5★', 'var(--r5)']
];

export function renderFilters(): void {
    $('#status').querySelectorAll<HTMLButtonElement>('button').forEach(b =>
        b.setAttribute('aria-pressed', String(b.dataset.s === S.filter.status)));
    $('#chips').innerHTML = CHIPS.map(([k, l, c]) =>
        `<button class="chip" data-r="${k}" style="--c:${c}" aria-pressed="${S.filter.ratings.has(k)}"><i></i>${l}</button>`).join('')
        + TAGS.map(t => {
            const f = S.filter.tags.get(t.key);
            const title = tagFilterTitle(t, f);
            return `<button class="chip chip-tag" data-tag="${t.key}" data-state="${f ?? 'off'}" aria-pressed="${!!f}" aria-label="${esc(title)}" title="${esc(title)}">${t.icon}</button>`;
        }).join('');
    $<HTMLSelectElement>('#sort').value = S.filter.sort;
    $('#reshuffle').hidden = S.filter.sort !== 'shuffle';
    updateMaster();
}

function updateMaster(): void {
    const m = $<HTMLInputElement>('#master');
    const shownSel = S.view.filter(t => S.sel.has(t.id)).length;
    m.checked = S.view.length > 0 && shownSel === S.view.length;
    m.indeterminate = shownSel > 0 && shownSel < S.view.length;
}

export function renderBulk(): void {
    const n = S.sel.size;
    const bar = $('#bulk');
    bar.classList.toggle('open', n > 0);
    bar.inert = !n; // closed: can't be tabbed to or clicked
    $('#bulkCount').textContent = `${n} selected`;
    const sel = $('#selShown');
    sel.hidden = S.view.every(t => S.sel.has(t.id));
    sel.textContent = `Select all ${S.view.length}`;
    updateBarSpace();
    $<HTMLButtonElement>('#bulkRemove').disabled = !S.source?.editable;
    // A tag toggle is pressed when every selected song already has the tag; pressing it then removes it.
    $('#bulk').querySelectorAll<HTMLElement>('[data-tag]').forEach(b => {
        const tag = b.dataset.tag as TagKey;
        b.setAttribute('aria-pressed', String(n > 0 && [...S.sel].every(id => hasTag(id, tag))));
    });
    updateMaster();
}

/**
 * Keeps CSS variables with the height of the top bar (--top-h), the player bar (--deck-h)
 * and the space the selection bar needs (--bulk-space), so the sticky filter row, the list
 * and toasts always line up with them, whatever font or screen size changes their height.
 */
export function updateBarSpace(): void {
    const root = document.documentElement.style;
    const bar = $('#bulk');
    root.setProperty('--top-h', `${$('.top').getBoundingClientRect().height}px`);
    root.setProperty('--deck-h', `${$('#deck').offsetHeight}px`);
    root.setProperty('--bulk-space', bar.classList.contains('open') ? `${bar.offsetHeight + 12}px` : '0px');
}

/**
 * Selection from clicking a row, like a file manager: a click selects just that row (or clears it
 * if it's the only one selected), Ctrl/Cmd+click adds or removes it, and Shift+click selects the
 * range from the last clicked row, replacing the selection (Ctrl+Shift adds the range instead).
 */
export function clickSelect(id: string, ctrl: boolean, shift: boolean): void {
    const ids = S.view.map(t => t.id);
    if (shift && S.anchor && ids.includes(S.anchor) && ids.includes(id)) {
        let a = ids.indexOf(S.anchor);
        let b = ids.indexOf(id);
        if (a > b) [a, b] = [b, a];
        if (!ctrl) S.sel.clear();
        for (let i = a; i <= b; i++) S.sel.add(ids[i]);
        // the anchor stays put, so another Shift+click resizes the same range
    } else if (ctrl) {
        if (S.sel.has(id)) S.sel.delete(id); else S.sel.add(id);
        S.anchor = id;
    } else {
        const onlyThis = S.sel.size === 1 && S.sel.has(id);
        S.sel.clear();
        if (!onlyThis) S.sel.add(id);
        S.anchor = id;
    }
    syncSelDom();
}

/** Toggles one row, or a range from the last clicked row when shift is held. */
export function toggleSel(id: string, on: boolean, shift: boolean): void {
    if (shift && S.anchor) {
        const ids = S.view.map(t => t.id);
        let a = ids.indexOf(S.anchor);
        let b = ids.indexOf(id);
        if (a > -1 && b > -1) {
            if (a > b) [a, b] = [b, a];
            for (let i = a; i <= b; i++) on ? S.sel.add(ids[i]) : S.sel.delete(ids[i]);
        }
    } else if (on) S.sel.add(id);
    else S.sel.delete(id);
    S.anchor = id;
    syncSelDom();
}
