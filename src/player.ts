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
import { SDK_URL } from './config';
import { renderSummary, resumeTarget, rowEl, updateRow } from './list';
import { type Context, type Effect, type Playback, type PlaybackEvent, position, transition } from './playback';
import { S, hasTag, markPlayed, rOf, setRating, setTag } from './state';
import { type TagKey, tagDef, tagsHtml } from './tags';
import { toast } from './toast';
import type { PlayerSnapshot, SpotifyDevice, SpotifyPlaybackState, SpotifyTrack } from './types';
import { $, PAUSE_PATH, PLAY_PATH, fmt, starsHtml } from './util';

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

/**
 * Through the Spotify app, Spotify plays the playlist in its own order when a song ends. So once a
 * song is playing, Cullture adds the next one in its order to Spotify's queue, one at a time:
 * Spotify's queue can't be cleared, so after a jump a queued song is left over and plays next.
 * It reads Spotify's queue first, and adds nothing if the right song is already next.
 */
/** The song Spotify's queue was last looked at for: once per song, and again if Cullture starts it afresh. */
let queueSeenFor: string | null = null;

/**
 * The song Spotify will play next, or null if it isn't in the open list. Read from Spotify's
 * queue; if that can't be read, it's taken to be the song Cullture last queued.
 */
async function upNext(): Promise<string | null> {
    try {
        const res = await api<{ queue?: SpotifyTrack[] } | null>('/me/player/queue');
        if (!res?.queue) return S.spotifyQueued;
        const t = res.queue[0];
        return (t && matchSong({ id: t.id, uri: t.uri, linked: t.linked_from?.id, name: t.name, artists: (t.artists ?? []).map(a => a.name).join(', ') })) ?? null;
    } catch {
        return S.spotifyQueued;
    }
}

/** Adds `next` to Spotify's queue to follow `cur`, unless Spotify is already going to play it next. */
async function queueAfter(cur: string, next: string, uri: string): Promise<void> {
    const head = await upNext();
    if (S.pb.cur !== cur) return; // the song changed while asking
    // Already next, queued earlier or simply next in the playlist: adding it would play it twice.
    if (head === next) { S.spotifyQueued = next; return; }
    // A leftover from before a jump is next, and nothing can go in front of it; it's put right when it plays.
    if (S.spotifyQueued && head === S.spotifyQueued) return;
    S.spotifyQueued = next;
    await api('/me/player/queue', { method: 'POST', query: { uri, device_id: S.deviceId ?? '' } })
        .catch(() => { S.spotifyQueued = null; });
}

function followQueue(before: Playback, after: Playback): void {
    // Spotify moved on by itself (when Cullture starts a song, it waits for Spotify: `expect`).
    if (after.cur !== before.cur && after.cur && !after.expect) {
        // Whatever was queued has played, or isn't coming; queue afresh after this song.
        S.spotifyQueued = null;
        // Right as the last song ended, Spotify chose a song (a leftover from before a jump, or its
        // own pick): go to the one that should follow. Not mid-song (you picked it in Spotify), and not
        // long after the end (found on coming back from the background: it's moved on several songs).
        const endAt = before.at + before.dur - before.pos;
        const atEnd = before.mode === 'playing' && Math.abs(Date.now() - endAt) < 6000;
        const want = before.cur && context().next(before.cur);
        if (atEnd && want && want !== after.cur) { dispatch({ type: 'play', id: want }); return; }
    }
    if (after.expect) queueSeenFor = null;
    if (S.opts.waitForRating || after.mode !== 'playing' || after.expect || !after.cur || queueSeenFor === after.cur) return;
    const next = context().next(after.cur);
    const uri = next && S.byId.get(next)?.uri;
    if (!next || !uri) return;
    queueSeenFor = after.cur;
    void queueAfter(after.cur, next, uri);
}

/** The one place playback state changes. */
export function dispatch(event: PlaybackEvent): void {
    const before = S.pb;
    const [after, effects] = transition(before, event, context());
    S.pb = after;
    for (const fx of effects) run(fx);
    // Spotify has started the song we asked for. Setting repeat again: starting a song can reset it,
    // and Spotify doesn't promise to handle the two requests in the order they were sent.
    if (before.expect && !after.expect && after.cur === before.expect.id && playlistContext() && S.deviceId) void syncRepeat(S.deviceId);
    if (playlistContext()) followQueue(before, after);
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
    void S.sdk?.activateElement();
    const device = await findDevice().catch(() => null);
    if (!device) {
        dispatch({ type: 'failed', message: S.sdk ? 'The browser player lost its connection. Try again in a moment, or reload the page.' : NO_PLAYER });
        return;
    }
    const ids = alone ? [id] : orderFrom(id).slice(0, 50); // Spotify plays these in order by itself
    const uris = ids.map(x => S.byId.get(x)?.uri).filter((u): u is string => !!u);
    const ctx = playlistContext();
    // iPhones stop and stay silent when sent a bare list of songs, but play from a playlist fine.
    const body = ctx ? { context_uri: ctx, offset: { uri: uris[0] } } : { uris };
    // The song is next in Spotify's queue: skip to it, so it isn't left there to play again.
    // Not while Spotify is repeating a song for "wait for a rating": nothing is queued then.
    const skip = !!ctx && !positionMs && !S.opts.waitForRating && id === await upNext();
    try {
        // Forgotten only once the skip worked: after a failed one it's still queued, and pressing play skips to it again.
        if (skip) { await api('/me/player/next', { method: 'POST', query: { device_id: device } }); S.spotifyQueued = null; }
        else await api('/me/player/play', { method: 'PUT', query: { device_id: device }, body: { ...body, position_ms: Math.round(positionMs) } });
        if (ctx) await syncRepeat(device);
    } catch (e) {
        const s = statusOf(e);
        // 404 or 5xx (e.g. Bad gateway): the Spotify app went to sleep; look for it again next time
        if (!S.sdk && (s === 404 || (s ?? 0) >= 500)) {
            S.deviceId = null;
            dispatch({ type: 'failed', message: NO_PLAYER });
        } else if (s === 404) {
            dispatch({ type: 'failed', message: 'The browser player has disconnected. Reload the page to reconnect it.' });
        } else {
            dispatch({ type: 'failed', message: s === 403 ? 'Spotify refused playback. Playback control needs Spotify Premium.' : 'Couldn\'t start playback: ' + messageOf(e) });
        }
    }
}

/**
 * The playlist (or Liked Songs) to play from when playing through the Spotify app, or null for
 * the browser player, which is sent the songs directly.
 */
function playlistContext(): string | null {
    if (S.sdk || !S.source) return null;
    if (!S.source.liked) return `spotify:playlist:${S.source.id}`;
    return S.me ? `spotify:user:${S.me.id}:collection` : null;
}

/**
 * Phones freeze the app in the background, so it can't stop Spotify at the end of a song. While
 * waiting for ratings, have Spotify repeat the song instead of moving on; the app pauses it on return.
 */
async function syncRepeat(device: string | null): Promise<void> {
    const query = { state: S.opts.waitForRating ? 'track' : 'off', ...(device ? { device_id: device } : {}) };
    await api('/me/player/repeat', { method: 'PUT', query }).catch(() => { /* nothing active yet; not worth a toast */ });
}

/** On opening or returning to the app (phones): make sure Spotify is repeating, if waiting for ratings. */
export function loopIfWaiting(): void {
    if (S.opts.waitForRating && !S.sdk) void syncRepeat(S.deviceId); // without a device yet, Spotify uses the active one
}

/** Pause, resume or seek, through the browser player or the Web API. `failMessage` reports errors. */
async function control(viaSdk: () => Promise<void>, path: string, query: Record<string, number> = {}, failMessage?: string): Promise<void> {
    try {
        if (S.sdk) await viaSdk();
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

/** Shown when there's neither a browser player nor an awake Spotify app to play through. */
const NO_PLAYER = 'Couldn\'t reach the Spotify app. Phones put it to sleep unless it\'s playing, so start any song in it, then come back and press play.';

export async function playSong(id: string): Promise<void> {
    if (!S.byId.has(id)) return;
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
export const prefsChanged = () => {
    primeBeeper();
    dispatch({ type: 'prefsChanged' });
    if (playlistContext() && S.deviceId && S.pb.mode !== 'idle') void syncRepeat(S.deviceId);
};

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

/** Toggles a tag on the playing song (the I and P keys). */
export function toggleTagCurrent(tag: TagKey): void {
    const id = S.pb.cur;
    if (!id) return;
    const on = !hasTag(id, tag);
    setTag([id], tag, on);
    updateRow(id);
    renderSummary();
    renderDeck();
    const label = tagDef(tag).label.toLowerCase();
    toast(on ? `Marked as ${label}` : `No longer marked ${label}`, { undo: () => toggleTagCurrentFor(id, tag, !on) });
}

function toggleTagCurrentFor(id: string, tag: TagKey, on: boolean): void {
    setTag([id], tag, on);
    updateRow(id);
    renderSummary();
    renderDeck();
}

/** Call after ratings change some other way (list stars, the bulk bar). */
export function ratingsChanged(ids: string[]): void {
    const id = S.pb.cur;
    if (!id || !ids.includes(id)) return;
    renderDeck();
    dispatch({ type: 'rated', id, advance: false });
}

/* ---------- Spotify ---------- */

/** A song in the list with this title and artists, ignoring capitalisation (copies can differ, "To" vs "to"). */
function sameSong(name?: string, artists?: string): string | undefined {
    if (!name) return undefined;
    const key = (n: string, a = '') => `${n}\n${a}`.toLowerCase();
    const want = key(name, artists);
    return S.tracks.find(t => key(t.name, t.artists) === want)?.id;
}

/** The song in the open list that a song from Spotify is, if any. */
function matchSong({ id, uri, linked, name, artists }: Pick<PlayerSnapshot, 'id' | 'uri' | 'linked' | 'name' | 'artists'>): string | undefined {
    // When a song isn't available in your country, Spotify plays another copy of it (often from a
    // different album) and says which song it was asked for in `linked`. Check that first: the copy
    // may also be in the list, and matching it would jump to its place in the playlist.
    return linked && S.byId.has(linked) ? linked
        : id && S.byId.has(id) ? id
            : [...S.byId.values()].find(t => t.uri === uri)?.id
                // Another copy of the same song (a single vs the album version), e.g. started in the Spotify app.
                ?? sameSong(name, artists);
}

/** Turns a Spotify report into an event, matching the song to the open list. */
function report(snap: PlayerSnapshot): void {
    dispatch({ type: 'spotify', id: matchSong(snap) ?? null, paused: snap.paused, pos: snap.pos || 0, dur: snap.dur || 0 });
}

/** Our browser player's device name. Other tabs' players show up in the device list under it. */
const SDK_NAME = 'Cullture (this browser)';

/** Settles once the browser player is ready (true) or has failed to start (false). */
let sdkLoading = Promise.resolve(false);

export function loadSDK(): Promise<boolean> {
    return sdkLoading = new Promise(resolve => {
        let done = false;
        const finish = (v: boolean) => { if (!done) { done = true; resolve(v); } };

        window.onSpotifyWebPlaybackSDKReady = () => {
            const p = new Spotify.Player({
                name: SDK_NAME,
                volume: 0.8,
                getOAuthToken: cb => { getToken().then(cb).catch(() => { /* signed out */ }); }
            });
            p.addListener('ready', ({ device_id }) => {
                S.sdk = p;
                S.deviceId = device_id;
                finish(true);
            });
            p.addListener('not_ready', () => { S.deviceId = null; });
            p.addListener('initialization_error', () => finish(false));
            p.addListener('authentication_error', () => finish(false));
            p.addListener('account_error', () => {
                toast('Playing in the browser needs Spotify Premium.');
                finish(false);
            });
            p.addListener('playback_error', ({ message }) => toast('Playback problem: ' + message));
            p.addListener('player_state_changed', st => {
                if (!st) return;
                const ct = st.track_window?.current_track;
                report({ id: ct?.id, uri: ct?.uri, linked: ct?.linked_from?.id, name: ct?.name, artists: ct?.artists.map(a => a.name).join(', '), paused: st.paused, pos: st.position, dur: st.duration });
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

/**
 * The device to play on. Phones can't run the browser player, so without it this plays through
 * a Spotify app instead (Spotify Connect): the active one, else a phone, else any.
 */
async function findDevice(): Promise<string | null> {
    await sdkLoading;
    if (S.deviceId) return S.deviceId;
    // The browser player has dropped out and reconnects by itself; don't start playing on some other device meanwhile.
    if (S.sdk) return null;
    const res = await api<{ devices?: SpotifyDevice[] } | null>('/me/player/devices');
    // Skip browser players from other tabs (e.g. a laptop): they'd play silently somewhere else.
    const usable = (res?.devices ?? []).filter(d => d.id && !d.is_restricted && d.name !== SDK_NAME);
    const d = usable.find(x => x.is_active) ?? usable.find(x => x.type === 'Smartphone') ?? usable[0];
    if (!d) return null;
    S.deviceId = d.id;
    followSpotify();
    toast(`Playing on ${d.name}`);
    return d.id;
}

/** Spotify doesn't push state for other devices, so check on it every few seconds (and now). */
export function followSpotify(): void {
    if (!S.pollTimer) S.pollTimer = window.setInterval(poll, 2500);
    void poll();
}

/** A check is on its way. On a slow connection they'd pile up, and an older answer could arrive after a newer one. */
let polling = false;

async function poll(): Promise<void> {
    if (document.hidden || polling) return;
    polling = true;
    try {
        // market=from_token makes Spotify say when it has swapped in another copy of a song
        const st = await api<SpotifyPlaybackState | null>('/me/player', { query: { market: 'from_token' } });
        // Opened while Spotify was already playing: follow that device.
        if (!S.deviceId && st?.item && st.device?.id && !st.device.is_restricted && st.device.name !== SDK_NAME) S.deviceId = st.device.id;
        const onChosenDevice = !st?.device?.id || st.device.id === S.deviceId;
        if (st?.item && onChosenDevice) {
            report({
                id: st.item.id, uri: st.item.uri, linked: st.item.linked_from?.id,
                name: st.item.name, artists: (st.item.artists ?? []).map(a => a.name).join(', '),
                paused: !st.is_playing, pos: st.progress_ms ?? 0, dur: st.item.duration_ms
            });
        } else {
            // Nothing is playing on the chosen device: nothing at all, or it's playing somewhere else.
            dispatch({ type: 'spotify', id: null, paused: true, pos: curPos(), dur: 0 });
        }
    } catch { /* try again next time */ } finally { polling = false; }
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

    $('#dTags').innerHTML = t ? tagsHtml(k => hasTag(t.id, k)) : '';

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