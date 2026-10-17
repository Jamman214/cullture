import './styles.css';
import { messageOf } from './api';
import { SignedOutError, getClientId, handleRedirect, hasToken, login, setClientId, signOut } from './auth';
import { KEY, MOCK, REDIRECT } from './config';
import { exportRatings, importRatings, openCull, refreshCull, removeTracks, reviewCull, cullIds, saveKeepers } from './cull';
import { clickSelect, renderBulk, renderList, renderSummary, reshuffle, resumeTarget, syncSelDom, toggleSel, updateBarSpace, updateRow } from './list';
import {
    goNext, goPrev, loadSDK, playSong, prefsChanged, rateCurrent, ratingsChanged, renderDeck, seekBy, seekToFraction, setDragging, toggleTagCurrent, togglePlay, useTestSpeaker
} from './player';
import { S, flushRatings, hasTag, rOf, saveOpts, setRating, setTag } from './state';
import { nextTagFilter, TAGS, type TagKey, tagDef } from './tags';
import { getMe, getSources } from './spotify';
import { toast } from './toast';
import type { SortKey, StatusFilter } from './types';
import { $, LS, esc, plural, starsHtml } from './util';
import { downloadSource, openSource, renderPicker, show, showSetup } from './views';

/**
 * Rates many songs at once, with an undo. Only the affected rows are redrawn, so the
 * list doesn't move and filters aren't reapplied until you next change them.
 */
function bulkRate(ids: string[], r: number | null): void {
    const prev = ids.map(id => [id, rOf(id)] as const);
    const refresh = () => {
        for (const id of ids) updateRow(id);
        renderSummary();
        ratingsChanged(ids);
    };
    setRating(ids, r);
    refresh();
    toast(r ? `Rated ${plural(ids.length, 'song')} ${r}★` : `Cleared ratings on ${plural(ids.length, 'song')}`, {
        undo: () => {
            for (const [id, old] of prev) setRating([id], old || null);
            refresh();
        }
    });
}

const closest = <T extends Element = HTMLElement>(e: Event, sel: string) =>
    (e.target as Element | null)?.closest<T>(sel) ?? null;

function bindSetup(): void {
    $('#copyRedirect').onclick = () => { void navigator.clipboard?.writeText(REDIRECT).then(() => toast('Redirect URI copied.')); };
    $('#connectBtn').onclick = () => {
        const id = $<HTMLInputElement>('#clientId').value.trim();
        if (!/^[0-9a-f]{32}$/i.test(id)) {
            toast('A Client ID is 32 letters and numbers. Copy it from your app\'s settings page.');
            return;
        }
        setClientId(id);
        void login();
    };
    $('#srcGrid').onclick = e => {
        const id = closest(e, '.src')?.dataset.id;
        if (!id) return;
        if (closest(e, '.src-act')) { void downloadSource(id); return; }
        const open = closest<HTMLButtonElement>(e, '.src-open');
        if (open && !open.disabled) void openSource(id);
    };
    $('#switchBtn').onclick = renderPicker;
    $('#cullBtn').onclick = openCull;
}

function bindMenu(): void {
    const menu = $('#menu');
    $('#menuBtn').onclick = e => {
        e.stopPropagation();
        menu.hidden = !menu.hidden;
        $('#menuBtn').setAttribute('aria-expanded', String(!menu.hidden));
    };
    document.addEventListener('click', e => { if (!closest(e, '#menuWrap')) menu.hidden = true; });
    menu.onclick = e => {
        const act = closest(e, 'button')?.dataset.act;
        if (!act) return;
        menu.hidden = true;
        switch (act) {
            case 'reload':
                if (S.source) void openSource(S.source.id, { refresh: true });
                else void loadSources().then(renderPicker);
                break;
            case 'export': exportRatings(); break;
            case 'import': $('#importFile').click(); break;
            case 'signout': signOut(); S.sdk?.disconnect(); location.reload(); break;
            case 'clientid': signOut(); showSetup(); break;
        }
    };
    const file = $<HTMLInputElement>('#importFile');
    file.onchange = () => {
        const f = file.files?.[0];
        if (f) void importRatings(f);
        file.value = '';
    };
}

function bindFilters(): void {
    let qTimer: number | undefined;
    $<HTMLInputElement>('#q').oninput = e => {
        clearTimeout(qTimer);
        const v = (e.target as HTMLInputElement).value;
        qTimer = window.setTimeout(() => { S.filter.q = v; renderList(); }, 150);
    };
    $('#status').onclick = e => {
        const b = closest(e, 'button');
        if (!b?.dataset.s) return;
        S.filter.status = b.dataset.s as StatusFilter;
        renderList();
    };
    $('#chips').onclick = e => {
        const chip = closest(e, '.chip');
        const tag = chip?.dataset.tag as TagKey | undefined;
        if (tag) {
            const next = nextTagFilter(S.filter.tags.get(tag));
            if (next) S.filter.tags.set(tag, next); else S.filter.tags.delete(tag);
            renderList();
            return;
        }
        const k = chip?.dataset.r;
        if (!k) return;
        if (S.filter.ratings.has(k)) S.filter.ratings.delete(k);
        else S.filter.ratings.add(k);
        renderList();
    };
    $<HTMLSelectElement>('#sort').onchange = e => {
        S.filter.sort = (e.target as HTMLSelectElement).value as SortKey;
        if (S.filter.sort === 'shuffle') reshuffle(); // a fresh order each time it's chosen
        renderList();
    };
    // Clicking a segment of the progress bar filters to that group.
    $('#reshuffle').onclick = () => { reshuffle(); renderList(); };
    $('#bar').onclick = e => {
        const k = closest(e, 'button')?.dataset.k;
        if (!k) return;
        S.filter.ratings.clear();
        S.filter.status = 'all';
        if (k === 'heard') { S.filter.ratings.add('none'); S.filter.status = 'played'; }
        else if (k === 'none') S.filter.status = 'unplayed';
        else S.filter.ratings.add(k);
        renderList();
    };
    $('#resumeBtn').onclick = () => {
        const t = resumeTarget();
        if (t) { S.queue = null; void playSong(t.id); }
    };
}

function bindList(): void {
    const list = $('#list');
    list.addEventListener('click', e => {
        const row = closest(e, '.row');
        const id = row?.dataset.id;
        if (!id) return;
        const star = closest(e, '.star');
        if (star) {
            const v = Number(star.dataset.v);
            setRating([id], rOf(id) === v ? null : v);
            updateRow(id);
            renderSummary();
            ratingsChanged([id]);
            return;
        }
        if (closest(e, '.pbtn')) { S.queue = null; void playSong(id); return; }
        const target = e.target as HTMLElement;
        if (target.classList.contains('ck')) { toggleSel(id, (target as HTMLInputElement).checked, e.shiftKey); return; }
        if (e.detail > 1) return; // second click of a double-click: the dblclick handler takes over
        clickSelect(id, e.ctrlKey || e.metaKey, e.shiftKey);
    });
    // Double-click plays the song; the first click has already selected it, and it stays selected.
    list.addEventListener('dblclick', e => {
        const id = closest(e, '.row')?.dataset.id;
        if (!id || closest(e, 'button,input')) return;
        S.queue = null;
        void playSong(id);
    });
    $<HTMLInputElement>('#master').onchange = e => {
        const on = (e.target as HTMLInputElement).checked;
        for (const t of S.view) on ? S.sel.add(t.id) : S.sel.delete(t.id);
        syncSelDom();
    };
}

function bindBulk(): void {
    // The list and toasts make room for the player and selection bars as they change size.
    const watch = new ResizeObserver(updateBarSpace);
    watch.observe($('#deck'));
    watch.observe($('.top'));
    watch.observe($('#bulk'));
    const stars = $('#bulkStars');
    stars.innerHTML = starsHtml(0);
    stars.onclick = e => {
        const s = closest(e, '.star');
        if (s) bulkRate([...S.sel], Number(s.dataset.v));
    };
    $('#selShown').onclick = () => { for (const t of S.view) S.sel.add(t.id); syncSelDom(); };
    $('#bulkClear').onclick = () => bulkRate([...S.sel], null);
    // A tag toggle adds the tag to the selection, or removes it if every selected song already has it.
    $('#bulk').querySelectorAll<HTMLElement>('[data-tag]').forEach(btn => {
        btn.onclick = () => {
            const tag = btn.dataset.tag as TagKey;
            const ids = [...S.sel];
            const on = !ids.every(id => hasTag(id, tag));
            const prev = ids.map(id => [id, hasTag(id, tag)] as const);
            const refresh = () => { for (const id of ids) updateRow(id); renderSummary(); renderBulk(); renderDeck(); };
            setTag(ids, tag, on);
            refresh();
            const label = tagDef(tag).label.toLowerCase();
            toast(on ? `Marked ${plural(ids.length, 'song')} as ${label}` : `${plural(ids.length, 'song')} no longer marked ${label}`, {
                undo: () => { for (const [id, was] of prev) setTag([id], tag, was); refresh(); }
            });
        };
    });
    $('#bulkNone').onclick = () => { S.sel.clear(); syncSelDom(); };
    $('#bulkPlay').onclick = () => {
        const order = new Map(S.view.map((t, i) => [t.id, i]));
        S.queue = [...S.sel].sort((a, b) => (order.get(a) ?? 1e9) - (order.get(b) ?? 1e9));
        const first = S.queue.find(id => !(S.opts.skipRated && rOf(id))) || S.queue[0];
        toast(`Playing ${plural(S.queue.length, 'selected song')} in order.`);
        void playSong(first);
    };
    $('#bulkRemove').onclick = () => { void removeTracks([...S.sel]); };
}

function bindDeck(): void {
    $('#playBtn').onclick = togglePlay;
    $('#nextBtn').onclick = goNext;
    $('#prevBtn').onclick = goPrev;
    $('#fwdBtn').onclick = () => seekBy(15000);
    $('#backBtn').onclick = () => seekBy(-15000);
    $('#dStars').onclick = e => {
        const s = closest(e, '.star');
        if (!s) return;
        const v = Number(s.dataset.v);
        rateCurrent(rOf(S.pb.cur) === v ? null : v);
    };
    const seek = $<HTMLInputElement>('#seek');
    seek.oninput = () => setDragging(true);
    seek.onchange = () => { setDragging(false); seekToFraction(Number(seek.value) / 1000); };
    $<HTMLInputElement>('#optSkip').onchange = e => { S.opts.skipRated = (e.target as HTMLInputElement).checked; saveOpts(); };
    $<HTMLInputElement>('#optAdvance').onchange = e => { S.opts.autoAdvance = (e.target as HTMLInputElement).checked; saveOpts(); };
    $<HTMLInputElement>('#optWait').onchange = e => {
        S.opts.waitForRating = (e.target as HTMLInputElement).checked;
        saveOpts();
        prefsChanged();
    };
}

function bindDialogs(): void {
    $('#cullMax').onchange = refreshCull;
    $('#keepMin').onchange = refreshCull;
    $('#cullClose').onclick = () => $<HTMLDialogElement>('#cullDlg').close();
    $('#cullReview').onclick = reviewCull;
    $('#cullGo').onclick = () => {
        const ids = cullIds();
        $<HTMLDialogElement>('#cullDlg').close();
        void removeTracks(ids);
    };
    $('#keepGo').onclick = () => { void saveKeepers(); };
}

function bindKeys(): void {
    document.addEventListener('keydown', e => {
        if ($('#work').hidden || document.querySelector('dialog[open]')) return;
        const t = e.target as HTMLElement;
        if (t.matches('input[type=search],input[type=text],select,textarea') || e.metaKey || e.ctrlKey || e.altKey) return;
        if (e.key === '/') { e.preventDefault(); $('#q').focus(); return; }
        if (/^[1-5]$/.test(e.key)) { e.preventDefault(); rateCurrent(Number(e.key)); return; }
        const tag = TAGS.find(t => t.hotkey === e.key.toLowerCase());
        if (tag) { toggleTagCurrent(tag.key); return; }
        if (e.key === '0' || e.key === 'Backspace') { e.preventDefault(); rateCurrent(null); return; }
        if (e.key === ' ' && t.tagName !== 'BUTTON') { e.preventDefault(); togglePlay(); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) goNext(); else seekBy(15000); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) goPrev(); else seekBy(-15000); return; }
        if (e.key.toLowerCase() === 'n') goNext();
        if (e.key.toLowerCase() === 'm') seekToFraction(0.5);
        if (e.key === 'Escape' && S.sel.size) { S.sel.clear(); syncSelDom(); }
    });
}

async function loadSources(): Promise<void> {
    S.me = await getMe();
    S.sources = await getSources(S.me);
}

async function init(): Promise<void> {
    bindSetup(); bindMenu(); bindFilters(); bindList(); bindBulk(); bindDeck(); bindDialogs(); bindKeys();
    addEventListener('beforeunload', flushRatings);

    try { await handleRedirect(); } catch (e) { toast(messageOf(e)); }
    if (!getClientId() || !hasToken()) return showSetup();

    try {
        await loadSources();
    } catch (e) {
        if (e instanceof SignedOutError) return showSetup();
        show('picker');
        $('#srcGrid').innerHTML = `<div class="empty">${esc(messageOf(e))}</div>`;
        return;
    }

    if (MOCK) {
        $('#mockBadge').hidden = false;
        useTestSpeaker();
    } else {
        void loadSDK();
    }

    const last = LS.get<string | null>(KEY.lastSource, null);
    if (last && S.sources.some(s => s.id === last && s.readable)) void openSource(last);
    else renderPicker();
}

void init();
