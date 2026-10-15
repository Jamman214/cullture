/** Screen switching: setup, playlist picker, and the rating workspace. */
import { messageOf, statusOf } from './api';
import { getClientId } from './auth';
import { KEY, REDIRECT } from './config';
import { renderList } from './list';
import { renderDeck } from './player';
import { S, setTracks } from './state';
import { getTracks } from './spotify';
import { $, LS, esc, plural } from './util';

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
    $('#srcGrid').innerHTML = S.sources.map(s => {
        const prog = LS.get<{ total: number; rated: number } | null>(KEY.progress(s.id), null);
        const pct = prog?.total ? Math.round((prog.rated / prog.total) * 100) : 0;
        const art = s.liked
            ? `<div class="art liked">${HEART}</div>`
            : `<div class="art" style="${s.img ? `background-image:url('${esc(s.img)}')` : ''}"></div>`;
        const sub = !s.readable
            ? `By ${esc(s.owner || 'someone else')}. Spotify won't share its songs.`
            : (s.total != null ? plural(s.total, 'song') : '') + (prog ? `, ${pct}% rated` : '');
        return `<button class="src" data-id="${esc(s.id)}" ${s.readable ? '' : 'disabled'}>${art}<b>${esc(s.name)}</b><small>${sub}</small>${prog ? `<div class="mini"><i style="width:${pct}%"></i></div>` : ''}</button>`;
    }).join('');
}

export async function openSource(id: string): Promise<void> {
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
        const tracks = await getTracks(src, (n, total) => {
            const m = document.getElementById('loadMsg');
            if (m) m.textContent = `Loading songs… ${n}${total ? ' of ' + total : ''}`;
        });
        setTracks(tracks);
    } catch (e) {
        const msg = statusOf(e) === 403 ? 'Spotify only lets apps read playlists you own or collaborate on.' : esc(messageOf(e));
        list.innerHTML = `<div class="empty">${msg}<br><br><button class="btn" id="pickOther">Choose another</button></div>`;
        $('#pickOther').addEventListener('click', renderPicker);
        return;
    }
    renderList();
    renderDeck();
}
