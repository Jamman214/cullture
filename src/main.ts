import './styles.css';
import { messageOf } from './api';
import { SignedOutError, getClientId, handleRedirect, hasToken, login, setClientId, signOut } from './auth';
import { KEY, MOCK, MOCK_DEVICE, REDIRECT } from './config';
import { exportRatings, importRatings, openCull, refreshCull, removeTracks, reviewCull, cullIds, saveKeepers } from './cull';
import { renderList, renderSummary, resumeTarget, syncSelDom, toggleSel, updateRow } from './list';
import {
    goNext, goPrev, loadSDK, openDevices, playSong, prefsChanged, rateCurrent, ratingsChanged, renderDeck,
    seekBy, seekToFraction, setDevice, setDragging, togglePlay
} from './player';
import { S, flushRatings, rOf, saveOpts, setRating } from './state';
import { getMe, getSources } from './spotify';
import { toast } from './toast';
import type { SortKey, StatusFilter } from './types';
import { $, LS, esc, plural, starsHtml } from './util';
import { downloadSource, openSource, renderPicker, show, showSetup } from './views';

/** Rates many songs at once, with an undo. */
function bulkRate(ids: string[], r: number | null): void {
    const prev = ids.map(id => [id, rOf(id)] as const);
    setRating(ids, r);
    S.sel.clear();
    renderList();
    ratingsChanged(ids);
    toast(r ? `Rated ${plural(ids.length, 'song')} ${r}★` : `Cleared ratings on ${plural(ids.length, 'song')}`, {
        undo: () => {
            for (const [id, old] of prev) setRating([id], old || null);
            renderList();
            renderDeck();
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
            case 'device': void openDevices(); break;
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
        const k = closest(e, '.chip')?.dataset.r;
        if (!k) return;
        if (S.filter.ratings.has(k)) S.filter.ratings.delete(k);
        else S.filter.ratings.add(k);
        renderList();
    };
    $<HTMLSelectElement>('#sort').onchange = e => {
        S.filter.sort = (e.target as HTMLSelectElement).value as SortKey;
        renderList();
    };
    // Clicking a segment of the progress bar filters to that group.
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
        toggleSel(id, !S.sel.has(id), e.shiftKey);
    });
    list.addEventListener('dblclick', e => {
        const id = closest(e, '.row')?.dataset.id;
        if (id && !closest(e, 'button,input')) { S.queue = null; void playSong(id); }
    });
    $<HTMLInputElement>('#master').onchange = e => {
        const on = (e.target as HTMLInputElement).checked;
        for (const t of S.view) on ? S.sel.add(t.id) : S.sel.delete(t.id);
        syncSelDom();
    };
}

function bindBulk(): void {
    const stars = $('#bulkStars');
    stars.innerHTML = starsHtml(0);
    stars.onclick = e => {
        const s = closest(e, '.star');
        if (s) bulkRate([...S.sel], Number(s.dataset.v));
    };
    $('#selShown').onclick = () => { for (const t of S.view) S.sel.add(t.id); syncSelDom(); };
    $('#bulkClear').onclick = () => bulkRate([...S.sel], null);
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
    const dev = $<HTMLDialogElement>('#devDlg');
    $('#devList').onclick = e => {
        const b = closest(e, '.dev');
        if (!b?.dataset.id) return;
        setDevice(b.dataset.id, b.dataset.name);
        dev.close();
        if (S.pb.cur) void playSong(S.pb.cur);
    };
    $('#devRefresh').onclick = () => { dev.close(); setTimeout(() => { void openDevices(); }, 0); };
    $('#devClose').onclick = () => dev.close();

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
        if (e.key === '0' || e.key === 'Backspace') { e.preventDefault(); rateCurrent(null); return; }
        if (e.key === ' ' && t.tagName !== 'BUTTON') { e.preventDefault(); togglePlay(); return; }
        if (e.key === 'ArrowRight') { e.preventDefault(); if (e.shiftKey) goNext(); else seekBy(15000); return; }
        if (e.key === 'ArrowLeft') { e.preventDefault(); if (e.shiftKey) goPrev(); else seekBy(-15000); return; }
        if (e.key.toLowerCase() === 'n') goNext();
        if (e.key.toLowerCase() === 'm') seekToFraction(0.45);
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
        setDevice(MOCK_DEVICE, 'Test speaker (simulated)');
    } else {
        void loadSDK().then(ok => {
            if (!ok) setDevice(S.deviceId, S.deviceId ? 'Spotify device' : null);
        });
    }

    const last = LS.get<string | null>(KEY.lastSource, null);
    if (last && S.sources.some(s => s.id === last && s.readable)) void openSource(last);
    else renderPicker();
}

void init();
