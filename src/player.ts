/**
 * Playback: runs the state machine in playback.ts, carries out the effects it asks for
 * (Spotify requests, marking songs played...), and draws the player bar from its state.
 *
 * Nothing here changes playback state directly. Buttons, keys, Spotify reports and a
 * timer all send events to `dispatch`, which asks the machine for the new state.
 */
import { api, messageOf, statusOf } from './api';
import { getToken } from './auth';
import { primeBeeper, setBeeping } from './beeper';
import { KEY, SDK_URL } from './config';
import { renderSummary, resumeTarget, rowEl, updateRow } from './list';
import { type Context, type Effect, type PlaybackEvent, position, transition } from './playback';
import { S, markPlayed, rOf, setRating } from './state';
import { getDevices } from './spotify';
import { toast } from './toast';
import type { PlayerSnapshot, SpotifyPlaybackState } from './types';
import { $, LS, PAUSE_PATH, PLAY_PATH, esc, fmt, starsHtml } from './util';

const usingSdk = () => !!S.sdk && S.deviceId === S.sdkDevice;

/* ---------- The machine ---------- */

/** Play order: the play-selected list if set, otherwise the list as currently shown. */
const baseOrder = () => (S.queue?.length ? S.queue : S.view.map(t => t.id));

/** The song ids to play starting at `id`, skipping already-rated songs if that option is on. */
function orderFrom(id: string): string[] {
    let base = baseOrder();
    if (!base.includes(id)) base = S.tracks.map(t => t.id);
    const rest = base.slice(base.indexOf(id) + 1).filter(x => !(S.opts.skipRated && rOf(x)));
    return [id, ...rest];
}

/** Everything the machine needs to know about the rest of the app, as of now. */
const context = (): Context => ({
    now: Date.now(),
    waitForRating: S.opts.waitForRating,
    isRated: id => !!rOf(id),
    duration: id => S.byId.get(id)?.dur ?? 0,
    next: id => (id ? orderFrom(id)[1] : resumeTarget()?.id) ?? null,
    prev: id => {
        let base = baseOrder();
        if (!base.includes(id)) base = S.tracks.map(t => t.id);
        const i = base.indexOf(id);
        return i > 0 ? base[i - 1] : null;
    }
});

/** The one place playback state changes. */
export function dispatch(event: PlaybackEvent): void {
    const before = S.pb;
    const [after, effects] = transition(before, event, context());
    S.pb = after;
    for (const fx of effects) run(fx);
    if (after !== before) {
        if (after.cur !== before.cur) {
            updateRow(before.cur);
            updateRow(after.cur);
            if (after.cur) rowEl(after.cur)?.scrollIntoView({ block: 'nearest' });
        }
        renderDeck();
    }
}

function run(fx: Effect): void {
    switch (fx.kind) {
        case 'play': void sendPlay(fx.id, fx.alone, fx.position); break;
        case 'pause': void control(() => S.sdk!.pause(), '/me/player/pause'); break;
        case 'resume': void control(() => S.sdk!.resume(), '/me/player/play', {}, 'Couldn\'t resume playback'); break;
        case 'seek': void control(() => S.sdk!.seek(Math.round(fx.ms)), '/me/player/seek', { position_ms: Math.round(fx.ms) }); break;
        case 'played': if (markPlayed(fx.id)) renderSummary(); break;
        case 'toast': toast(fx.text); break;
        case 'later': setTimeout(() => dispatch(fx.event), fx.ms); break;
    }
}

async function sendPlay(id: string, alone: boolean, positionMs: number): Promise<void> {
    if (!S.deviceId) {
        dispatch({ type: 'failed', message: 'Choose where to play first.' });
        void openDevices();
        return;
    }
    void S.sdk?.activateElement();
    const ids = alone ? [id] : orderFrom(id).slice(0, 50); // Spotify plays these in order by itself
    const uris = ids.map(x => S.byId.get(x)?.uri).filter((u): u is string => !!u);
    try {
        await api('/me/player/play', { method: 'PUT', query: { device_id: S.deviceId }, body: { uris, position_ms: Math.round(positionMs) } });
    } catch (e) {
        const s = statusOf(e);
        if (s === 404) {
            setDevice(null);
            dispatch({ type: 'failed', message: 'That playback device isn\'t available. Pick another.' });
            void openDevices();
        } else {
            dispatch({ type: 'failed', message: s === 403 ? 'Spotify refused playback. Playback control needs Spotify Premium.' : 'Couldn\'t start playback: ' + messageOf(e) });
        }
    }
}

/** Pause, resume or seek, through the browser player or the Web API. `failMessage` reports errors. */
async function control(viaSdk: () => Promise<void>, path: string, query: Record<string, number> = {}, failMessage?: string): Promise<void> {
    try {
        if (usingSdk()) await viaSdk();
        else await api(path, { method: 'PUT', query: { ...query, device_id: S.deviceId ?? '' } });
    } catch (e) {
        if (failMessage) dispatch({ type: 'failed', message: `${failMessage}: ${messageOf(e)}` });
    }
}

// Four times a second: let the machine notice a song ending, and move the seek bar.
setInterval(() => {
    dispatch({ type: 'tick' });
    if (S.pb.mode === 'playing') renderSeek();
}, 250);

/* ---------- Actions for the rest of the app ---------- */

export async function playSong(id: string): Promise<void> {
    if (!S.byId.has(id)) return;
    if (!S.deviceId) {
        await openDevices();
        if (!S.deviceId) return;
    }
    primeBeeper(); // sound is only allowed after a click, so unlock it now
    dispatch({ type: 'play', id });
}

export const togglePlay = () => { primeBeeper(); dispatch({ type: 'toggle' }); };
export const goNext = () => dispatch({ type: 'next' });
export const goPrev = () => dispatch({ type: 'prev' });
export const curPos = () => position(S.pb, Date.now());
export const seekTo = (ms: number) => dispatch({ type: 'seek', ms });
export const seekBy = (deltaMs: number) => seekTo(curPos() + deltaMs);
export const seekToFraction = (f: number) => seekTo(S.pb.dur * f);
export const prefsChanged = () => { primeBeeper(); dispatch({ type: 'prefsChanged' }); };

/** Rates the current song from the player bar or a number key. */
export function rateCurrent(r: number | null): void {
    const id = S.pb.cur;
    if (!id) return;
    setRating([id], r);
    updateRow(id);
    renderSummary();
    renderDeck();
    const st = $('#dStars');
    st.classList.remove('pop');
    void st.offsetWidth; // restart the animation
    st.classList.add('pop');
    dispatch({ type: 'rated', id, advance: !!r && S.opts.autoAdvance });
}

/** Call after ratings change some other way (list stars, the bulk bar). */
export function ratingsChanged(ids: string[]): void {
    const id = S.pb.cur;
    if (!id || !ids.includes(id)) return;
    renderDeck();
    dispatch({ type: 'rated', id, advance: false });
}

/* ---------- Spotify ---------- */

/** Turns a Spotify report into an event, matching the song to the open list. */
function report({ id, uri, linked, paused, pos, dur }: PlayerSnapshot): void {
    // Spotify may relink a song to a regional copy with a different id, so fall back to linked id and URI.
    const tid = id && S.byId.has(id) ? id
        : linked && S.byId.has(linked) ? linked
            : [...S.byId.values()].find(t => t.uri === uri)?.id;
    dispatch({ type: 'spotify', id: tid ?? null, paused, pos: pos || 0, dur: dur || 0 });
}

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
                report({ id: ct?.id, uri: ct?.uri, linked: ct?.linked_from?.id, paused: st.paused, pos: st.position, dur: st.duration });
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
        report({ id: st.item.id, uri: st.item.uri, paused: !st.is_playing, pos: st.progress_ms ?? 0, dur: st.item.duration_ms });
    } catch { /* try again next time */ }
}

/* ---------- Drawing the player bar ---------- */

const TITLE = document.title;
let dragging = false;

/** The seek bar is being dragged, so don't move it under the pointer. */
export function setDragging(on: boolean): void {
    dragging = on;
    if (on) $('#tCur').textContent = fmt((Number($<HTMLInputElement>('#seek').value) / 1000) * S.pb.dur);
}

/** Draws the player bar from the playback state. Safe to call any time. */
export function renderDeck(): void {
    const { mode, cur } = S.pb;
    const t = cur ? S.byId.get(cur) : undefined;
    const waiting = mode === 'waiting';

    $('#dArt').style.backgroundImage = t?.big ? `url('${t.big}')` : '';
    $('#dTitle').textContent = t ? t.name : 'Nothing playing';
    $('#dArtist').textContent = t ? t.artists : 'Press Resume or play any song';

    // Build the stars once, then only switch colours, so hover and transitions aren't interrupted.
    const r = t ? rOf(t.id) : 0;
    const st = $('#dStars');
    if (!st.children.length) st.innerHTML = starsHtml(r);
    st.dataset.r = String(r);
    st.querySelectorAll<HTMLElement>('.star').forEach(b => b.classList.toggle('on', r >= Number(b.dataset.v)));

    $('#playIcon').innerHTML = mode === 'playing' ? PAUSE_PATH : PLAY_PATH;
    $('#playBtn').setAttribute('aria-label', mode === 'playing' ? 'Pause' : 'Play');
    $<HTMLButtonElement>('#playBtn').disabled = waiting;
    $<HTMLButtonElement>('#fwdBtn').disabled = waiting;
    $('#deck').classList.toggle('waiting', waiting);
    document.title = waiting ? '⭐ Rate to continue · ' + TITLE : TITLE;
    setBeeping(waiting);

    $<HTMLInputElement>('#optSkip').checked = S.opts.skipRated;
    $<HTMLInputElement>('#optAdvance').checked = S.opts.autoAdvance;
    $<HTMLInputElement>('#optWait').checked = S.opts.waitForRating;
    renderSeek();
}

export function renderSeek(): void {
    if (dragging) return;
    const p = curPos();
    const dur = S.pb.dur;
    $('#tCur').textContent = fmt(p);
    $('#tDur').textContent = fmt(dur);
    $<HTMLInputElement>('#seek').value = String(dur ? Math.round((p / dur) * 1000) : 0);
}

/* ---------- Device picker ---------- */

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
