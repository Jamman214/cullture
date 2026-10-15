/** Playback: the Web Playback SDK (this browser) or remote control of another Spotify device. */
import { api, messageOf, statusOf } from './api';
import { getToken } from './auth';
import { KEY, SDK_URL } from './config';
import { renderSummary, resumeTarget, rowEl, updateRow } from './list';
import { S, markPlayed, rOf, setRating } from './state';
import { getDevices } from './spotify';
import { toast } from './toast';
import type { PlayerSnapshot, SpotifyPlaybackState } from './types';
import { $, LS, PAUSE_PATH, PLAY_PATH, esc, fmt, starsHtml } from './util';

const usingSdk = () => !!S.sdk && S.deviceId === S.sdkDevice;

export function loadSDK(): Promise<boolean> {
    return new Promise(resolve => {
        let done = false;
        const finish = (v: boolean) => { if (!done) { done = true; resolve(v); } };

        window.onSpotifyWebPlaybackSDKReady = () => {
            const p = new Spotify.Player({
                name: 'Cullture (this browser)',
                volume: 0.8,
                getOAuthToken: cb => { getToken().then(cb).catch(() => { /* signed out */ }); }
            });
            p.addListener('ready', ({ device_id }) => {
                S.sdk = p;
                S.sdkDevice = device_id;
                // Use the browser by default, unless the user picked another device last time.
                if (!S.deviceId || S.deviceId === LS.get<string | null>(KEY.sdkDevice, null)) setDevice(device_id, 'This browser');
                LS.set(KEY.sdkDevice, device_id);
                finish(true);
            });
            p.addListener('initialization_error', () => finish(false));
            p.addListener('authentication_error', () => finish(false));
            p.addListener('account_error', () => {
                toast('Playing in the browser needs Spotify Premium. Choose another device from the menu.');
                finish(false);
            });
            p.addListener('playback_error', ({ message }) => toast('Playback problem: ' + message));
            p.addListener('player_state_changed', st => {
                if (!st || S.deviceId !== S.sdkDevice) return;
                const ct = st.track_window?.current_track;
                applyState({ id: ct?.id, uri: ct?.uri, linked: ct?.linked_from?.id, paused: st.paused, pos: st.position, dur: st.duration });
            });
            p.connect();
        };

        const s = document.createElement('script');
        s.src = SDK_URL;
        s.onerror = () => finish(false);
        document.head.appendChild(s);
        setTimeout(() => finish(false), 15000);
    });
}

export function setDevice(id: string | null, name?: string | null): void {
    S.deviceId = id;
    S.deviceName = name ?? null;
    LS.set(KEY.device, id);
    $('#deviceBtn').textContent = id ? 'Playing on: ' + (name || 'Spotify device') : 'Choose where to play';
    if (S.pollTimer) clearInterval(S.pollTimer);
    S.pollTimer = null;
    if (id && id !== S.sdkDevice) S.pollTimer = window.setInterval(poll, 2500);
}

/** For remote devices, Spotify doesn't push state, so check it every few seconds. */
async function poll(): Promise<void> {
    if (document.hidden) return;
    try {
        const st = await api<SpotifyPlaybackState | null>('/me/player');
        if (!st?.item) return;
        if (st.device?.id && st.device.id !== S.deviceId) return;
        applyState({ id: st.item.id, uri: st.item.uri, paused: !st.is_playing, pos: st.progress_ms ?? 0, dur: st.item.duration_ms });
    } catch { /* try again next tick */ }
}

function onTrackStarted(id: string): void {
    if (markPlayed(id)) renderSummary();
}

export function applyState({ id, uri, linked, paused, pos, dur }: PlayerSnapshot): void {
    // Spotify may relink a song to a regional copy with a different id, so fall back to linked id and URI.
    const tid = id && S.byId.has(id) ? id
        : linked && S.byId.has(linked) ? linked
            : [...S.byId.values()].find(t => t.uri === uri)?.id;
    if (tid && tid !== S.cur) {
        const old = S.cur;
        S.cur = tid;
        onTrackStarted(tid);
        updateRow(old);
        updateRow(tid);
        rowEl(tid)?.scrollIntoView({ block: 'nearest' });
    }
    S.playing = !paused;
    S.pos = pos || 0;
    S.dur = dur || (S.cur ? S.byId.get(S.cur)?.dur : 0) || 0;
    S.posAt = Date.now();
    renderDeck();
}

const baseOrder = () => (S.queue?.length ? S.queue : S.view.map(t => t.id));

/** The song ids to play starting at `id`, skipping already-rated songs if that option is on. */
function orderFrom(id: string): string[] {
    let base = baseOrder();
    if (!base.includes(id)) base = S.tracks.map(t => t.id);
    const rest = base.slice(base.indexOf(id) + 1).filter(x => !(S.opts.skipRated && rOf(x)));
    return [id, ...rest];
}

export async function playFrom(id: string): Promise<void> {
    const t = S.byId.get(id);
    if (!t) return;
    if (!S.deviceId) {
        await openDevices();
        if (!S.deviceId) return;
    }
    void S.sdk?.activateElement();
    const old = S.cur;
    S.cur = id;
    onTrackStarted(id);
    updateRow(old);
    updateRow(id);
    S.pos = 0; S.dur = t.dur; S.posAt = Date.now(); S.playing = true;
    renderDeck();

    // Hand Spotify the next 50 songs so it keeps going on its own.
    const uris = orderFrom(id).slice(0, 50).map(x => S.byId.get(x)!.uri);
    try {
        await api('/me/player/play', { method: 'PUT', query: { device_id: S.deviceId! }, body: { uris } });
    } catch (e) {
        S.playing = false;
        renderDeck();
        const s = statusOf(e);
        if (s === 404) { toast('That playback device isn\'t available. Pick another.'); setDevice(null); void openDevices(); }
        else if (s === 403) toast('Spotify refused playback. Playback control needs Spotify Premium.');
        else toast('Couldn\'t start playback: ' + messageOf(e));
    }
}

function nextId(): string | undefined {
    if (!S.cur) return resumeTarget()?.id;
    return orderFrom(S.cur)[1];
}

function prevId(): string | null {
    let base = baseOrder();
    if (!S.cur) return null;
    if (!base.includes(S.cur)) base = S.tracks.map(t => t.id);
    const i = base.indexOf(S.cur);
    return i > 0 ? base[i - 1] : null;
}

export function goNext(): void {
    const n = nextId();
    if (n) void playFrom(n);
    else toast('End of the list. Everything shown here is rated.');
}

export function goPrev(): void {
    const p = prevId();
    if (p) void playFrom(p);
}

export async function togglePlay(): Promise<void> {
    if (!S.cur) {
        const t = resumeTarget();
        if (t) void playFrom(t.id);
        return;
    }
    try {
        if (usingSdk()) {
            await S.sdk!.activateElement();
            await S.sdk!.togglePlay();
        } else {
            await api(S.playing ? '/me/player/pause' : '/me/player/play', { method: 'PUT', query: { device_id: S.deviceId ?? '' } });
            S.playing = !S.playing;
            S.posAt = Date.now();
            renderDeck();
        }
    } catch (e) {
        toast('Playback control failed: ' + messageOf(e));
    }
}

export const curPos = () => Math.min(S.dur, S.pos + (S.playing ? Date.now() - S.posAt : 0));

export async function seekTo(ms: number): Promise<void> {
    if (!S.cur) return;
    ms = Math.max(0, Math.min(S.dur - 1000, ms));
    S.pos = ms;
    S.posAt = Date.now();
    renderSeek();
    try {
        if (usingSdk()) await S.sdk!.seek(Math.round(ms));
        else await api('/me/player/seek', { method: 'PUT', query: { position_ms: Math.round(ms), device_id: S.deviceId ?? '' } });
    } catch { /* ignore */ }
}

export function rateCurrent(r: number | null): void {
    if (!S.cur) return;
    setRating([S.cur], r);
    updateRow(S.cur);
    renderSummary();
    renderDeck();
    const st = $('#dStars');
    st.classList.remove('pop');
    void st.offsetWidth; // restart the animation
    st.classList.add('pop');
    if (r && S.opts.autoAdvance) setTimeout(goNext, 300);
}

export function renderDeck(): void {
    const t = S.cur ? S.byId.get(S.cur) : undefined;
    $('#dArt').style.backgroundImage = t?.big ? `url('${t.big}')` : '';
    $('#dTitle').textContent = t ? t.name : 'Nothing playing';
    $('#dArtist').textContent = t ? t.artists : 'Press Resume or play any song';
    const r = t ? rOf(t.id) : 0;
    const st = $('#dStars');
    st.dataset.r = String(r);
    st.innerHTML = starsHtml(r, true);
    $('#playIcon').innerHTML = S.playing ? PAUSE_PATH : PLAY_PATH;
    $('#playBtn').setAttribute('aria-label', S.playing ? 'Pause' : 'Play');
    $<HTMLInputElement>('#optSkip').checked = S.opts.skipRated;
    $<HTMLInputElement>('#optAdvance').checked = S.opts.autoAdvance;
    renderSeek();
}

export function renderSeek(): void {
    if (S.dragging) return;
    const p = curPos();
    $('#tCur').textContent = fmt(p);
    $('#tDur').textContent = fmt(S.dur);
    $<HTMLInputElement>('#seek').value = String(S.dur ? Math.round((p / S.dur) * 1000) : 0);
}

const waitClose = (dlg: HTMLDialogElement) =>
    new Promise<void>(r => dlg.addEventListener('close', () => r(), { once: true }));

export async function openDevices(): Promise<void> {
    const dlg = $<HTMLDialogElement>('#devDlg');
    if (!dlg.open) dlg.showModal();
    const closed = waitClose(dlg);
    const list = $('#devList');
    list.innerHTML = '<p>Looking for devices…</p>';
    let devs;
    try { devs = await getDevices(); }
    catch (e) { list.innerHTML = `<p>${esc(messageOf(e))}</p>`; return closed; }

    if (S.sdkDevice && !devs.some(d => d.id === S.sdkDevice)) devs.unshift({ id: S.sdkDevice, name: 'This browser', type: 'Computer' });
    list.innerHTML = devs.length
        ? devs.map(d => {
            const name = d.id === S.sdkDevice ? 'This browser' : d.name;
            return `<button class="dev" data-id="${esc(d.id)}" data-name="${esc(name)}" aria-current="${d.id === S.deviceId}"><span>${esc(name)}</span><small>${esc(d.type)}</small></button>`;
        }).join('')
        : '<p>No devices found. Open Spotify on your phone or computer, then refresh.</p>';
    return closed;
}
