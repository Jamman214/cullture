/** Screen switching: setup, playlist picker, and the rating workspace. */
import { messageOf, statusOf } from './api';
import { getClientId } from './auth';
import { KEY, REDIRECT } from './config';
import { renderList } from './list';
import { renderDeck } from './player';
import { S, setTracks } from './state';
import { cacheMeta, isStale, loadCached, saveCached } from './cache';
import { getTracks } from './spotify';
import { toast } from './toast';
import type { Source, Track } from './types';
import { $, LS, ago, esc, plural } from './util';

type Screen = 'setup' | 'picker' | 'work';

export function show(which: Screen): void {
    for (const id of ['setup', 'picker', 'work'] as const) $('#' + id).hidden = id !== which;
    $('#menuWrap').hidden = which === 'setup';
    $('#switchBtn').hidden = which !== 'work';
    $('#cullBtn').hidden = which !== 'work';
    $('#deck').hidden = which !== 'work';
}

export function showSetup(): void {
    show('setup');
    $('#redirectShow').textContent = REDIRECT;
    $<HTMLInputElement>('#clientId').value = getClientId() ?? '';
    const w = $('#hostWarn');
    if (location.protocol === 'file:') {
        w.hidden = false;
        w.innerHTML = 'This page is open as a file, which Spotify can\'t redirect back to. Run <b>npm run dev</b> and open <b>http://127.0.0.1:5173/</b>.';
    } else if (location.hostname === 'localhost') {
        w.hidden = false;
        w.innerHTML = `Spotify no longer accepts <b>localhost</b> redirect URIs. Open this page at <b>${esc(REDIRECT.replace('localhost', '127.0.0.1'))}</b> instead.`;
    } else {
        w.hidden = true;
    }
}

const HEART = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M12 21s-7.5-4.6-9.6-9.2C.9 8.4 3 4.5 6.8 4.5c2.1 0 3.5 1.1 4.2 2.3h2c.7-1.2 2.1-2.3 4.2-2.3 3.8 0 5.9 3.9 4.4 7.3C19.5 16.4 12 21 12 21z"/></svg>';

export function renderPicker(): void {
    show('picker');
    renderGrid();
}

const ICON_REFRESH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 0 0-14.3-4.9L4 8M4 4v4h4M4 13a8 8 0 0 0 14.3 4.9L20 16M20 20v-4h-4"/></svg>';
const ICON_DOWNLOAD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 4v11M7 10l5 5 5-5M5 20h14"/></svg>';

/** Downloads in progress, so a card can show progress and two requests for one playlist share the work. */
const inflight = new Map<string, Promise<Track[]>>();
const progressText = new Map<string, string>();

/** Redraws the playlist cards without switching screens, so background downloads can update them. */
function renderGrid(): void {
    $('#srcGrid').innerHTML = S.sources.map(s => {
        const prog = LS.get<{ total: number; rated: number } | null>(KEY.progress(s.id), null);
        const pct = prog?.total ? Math.round((prog.rated / prog.total) * 100) : 0;
        const meta = cacheMeta(s.id);
        const stale = isStale(s);
        const busy = inflight.has(s.id);
        const art = s.liked
            ? `<div class="art liked">${HEART}</div>`
            : `<div class="art" style="${s.img ? `background-image:url('${esc(s.img)}')` : ''}"></div>`;
        const sub = !s.readable
            ? `By ${esc(s.owner || 'someone else')}. Spotify won't share its songs.`
            : (s.total != null ? plural(s.total, 'song') : '') + (prog ? `, ${pct}% rated` : '');
        const status = !s.readable ? ''
            : busy ? progressText.get(s.id) || 'Downloading…'
                : stale ? 'Changed on Spotify'
                    : meta ? `Saved ${ago(meta.savedAt)}`
                        : 'Not downloaded yet';
        const label = meta ? `Refresh ${s.name} from Spotify` : `Download ${s.name}`;
        const action = s.readable
            ? `<button class="src-act${stale ? ' stale' : ''}${busy ? ' busy' : ''}" aria-label="${esc(label)}" title="${esc(label)}" ${busy ? 'disabled' : ''}>${meta || busy ? ICON_REFRESH : ICON_DOWNLOAD}</button>`
            : '';
        return `<div class="src" data-id="${esc(s.id)}">
<button class="src-open" ${s.readable ? '' : 'disabled'}>${art}<b>${esc(s.name)}</b><small>${sub}</small>${status ? `<small class="src-status${stale ? ' stale' : ''}">${esc(status)}</small>` : ''}${prog ? `<div class="mini"><i style="width:${pct}%"></i></div>` : ''}</button>${action}</div>`;
    }).join('');
}

/** Downloads a playlist from Spotify and saves it. Shares one download if it's already running. */
function fetchAndSave(src: Source, onProgress?: (loaded: number, total: number) => void): Promise<Track[]> {
    let job = inflight.get(src.id);
    if (!job) {
        job = getTracks(src, (n, total) => {
            progressText.set(src.id, `Downloading… ${n}${total ? ' of ' + total : ''}`);
            if (!$('#picker').hidden) renderGrid();
            onProgress?.(n, total);
        })
            .then(async tracks => { await saveCached(src, tracks); return tracks; })
            .finally(() => { inflight.delete(src.id); progressText.delete(src.id); if (!$('#picker').hidden) renderGrid(); });
        inflight.set(src.id, job);
        if (!$('#picker').hidden) renderGrid();
    }
    return job;
}

/** The card button: downloads, or re-downloads, a playlist without opening it. */
export async function downloadSource(id: string): Promise<void> {
    const src = S.sources.find(s => s.id === id);
    if (!src) return;
    try {
        const tracks = await fetchAndSave(src);
        toast(`Saved ${plural(tracks.length, 'song')} from ${src.liked ? 'Liked Songs' : `“${src.name}”`}.`);
    } catch (e) {
        toast(statusOf(e) === 403 ? 'Spotify only lets apps read playlists you own or collaborate on.' : `Download failed: ${messageOf(e)}`);
    }
}

/** Opens a playlist, using the saved copy when there is one unless `refresh` is set. */
export async function openSource(id: string, { refresh = false } = {}): Promise<void> {
    const src = S.sources.find(s => s.id === id);
    if (!src) return renderPicker();
    S.source = src;
    S.sel.clear();
    S.queue = null;
    S.anchor = null;
    LS.set(KEY.lastSource, id);
    show('work');
    $('#srcName').textContent = src.name;
    $('#sumLine').textContent = '';
    $('#bar').innerHTML = '';
    $('#legend').innerHTML = '';
    const list = $('#list');
    list.innerHTML = '<div class="loading" id="loadMsg">Loading songs…</div>';

    try {
        const cached = refresh ? null : await loadCached(id);
        const tracks = cached ?? await fetchAndSave(src, (n, total) => {
            const m = document.getElementById('loadMsg');
            if (m) m.textContent = `Loading songs… ${n}${total ? ' of ' + total : ''}`;
        });
        if (S.source !== src) return; // another playlist was opened meanwhile
        setTracks(tracks);
        if (cached && isStale(src)) toast('This playlist has changed on Spotify. Use Reload songs from Spotify in the ⋯ menu to update it.');
    } catch (e) {
        if (S.source !== src) return;
        const msg = statusOf(e) === 403 ? 'Spotify only lets apps read playlists you own or collaborate on.' : esc(messageOf(e));
        list.innerHTML = `<div class="empty">${msg}<br><br><button class="btn" id="pickOther">Choose another</button></div>`;
        $('#pickOther').addEventListener('click', renderPicker);
        return;
    }
    renderList();
    renderDeck();
}
