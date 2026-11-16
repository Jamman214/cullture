/** The stats screen: gathers songs and ratings for the chosen scope, then draws what stats.ts works out. */
import { loadAllCached } from './cache';
import { KEY } from './config';
import { S } from './state';
import { getArtistImages } from './spotify';
import { type Group, type RankBy, type Stats, artistCover, artistDetail, artistIdsByName, computeStats, darkText, mergeDetails, rank, ratingColor, tileLabel, treemap } from './stats';
import { TAGS } from './tags';
import type { Track } from './types';
import { $, LS, STAR, esc, plural } from './util';
import { renderPicker, show } from './views';

/** Most artists the treemap shows; more makes the smallest rectangles too small to tap. */
const TREEMAP_MAX = 60;

let scope: 'all' | 'list' = 'all';
let from: 'picker' | 'work' = 'picker';
let scrollWas = 0;
/** Every saved song, read from IndexedDB once each time the screen opens. */
let saved: Track[] | null = null;
let cur: Stats | null = null;
let picked: string | null = null;
let seq = 0;
const RANKS: { by: RankBy; label: string; note: string }[] = [
    { by: 'weighted', label: 'Weighted', note: 'Average rating, weighted so a few songs don\'t outrank many.' },
    { by: 'avg', label: 'Average', note: 'Plain average rating; needs 3 or more rated songs.' },
    { by: 'count', label: 'Most rated', note: 'Most rated songs first.' }
];
const validRank = (by: unknown): by is RankBy => RANKS.some(r => r.by === by);
/** How each top card is ranked; each remembers its own choice. */
type TopCard = 'topArtists' | 'topAlbums';
const RANK_KEY = { topArtists: KEY.rankArtists, topAlbums: KEY.rankAlbums };
const rankBy = {} as Record<TopCard, RankBy>;
for (const id of ['topArtists', 'topAlbums'] as const) {
    const by = LS.get<RankBy>(RANK_KEY[id], 'weighted');
    rankBy[id] = validRank(by) ? by : 'weighted';
}
/** Treemap tiles in rating colours, or with artist photos (album covers where there's none). */
let photoTiles = LS.get<string>(KEY.artistTiles, 'colours') === 'photos';
/** Artist photo URL by Spotify artist ID, '' when Spotify has none; saved so each artist is asked for once. */
const photos = LS.get<Record<string, string>>(KEY.artistPhotos, {});
/** IDs asked for this session, so a failed or running request isn't repeated on every redraw. */
const asked = new Set<string>();

/** Opens the screen: on this playlist when coming from its song list, otherwise on all rated songs. */
export function openStats(): void {
    from = $('#work').hidden ? 'picker' : 'work';
    scrollWas = scrollY;
    scope = from === 'work' && S.source ? 'list' : 'all';
    saved = null;
    picked = null;
    show('stats');
    scrollTo(0, 0);
    void renderStats();
}

/** Back to where the screen was opened from, at the same scroll position. */
export function closeStats(): void {
    tip(null);
    if (from === 'work' && S.source) show('work'); else renderPicker();
    scrollTo(0, scrollWas);
}

export function setScope(s: 'all' | 'list'): void {
    if (s === scope) return;
    scope = s;
    picked = null;
    void renderStats();
}

/** Opens or closes an artist's details under the treemap. */
export function pickArtist(name: string): void {
    picked = picked === name ? null : name;
    for (const b of $('#statsBody').querySelectorAll<HTMLElement>('.tm-cell')) b.setAttribute('aria-pressed', String(b.dataset.a === picked));
    const panel = $('#tmDetail');
    panel.innerHTML = picked && cur ? detailHtml(cur, picked) : '';
    // Just its heading, so on a phone the chosen tile (and its tooltip) stays in view.
    if (picked) panel.querySelector('h3')?.scrollIntoView({ block: 'nearest' });
}

/** Switches the treemap between colours and photos, redrawing only the treemap. */
export function setLook(v: string): void {
    if ((v !== 'colours' && v !== 'photos') || (v === 'photos') === photoTiles) return;
    photoTiles = v === 'photos';
    LS.set(KEY.artistTiles, v);
    for (const b of $('#statsBody').querySelectorAll('[data-look]')) b.setAttribute('aria-pressed', String((b as HTMLElement).dataset.look === v));
    const box = document.getElementById('treemap');
    if (box && cur) drawTreemap(box, cur.artists.slice(0, TREEMAP_MAX));
}

/** Re-ranks one top card (by its id), redrawing only that card. */
export function setRankBy(id: string, by: string): void {
    if (!Object.hasOwn(RANK_KEY, id) || !validRank(by) || by === rankBy[id as TopCard]) return;
    const card = id as TopCard;
    rankBy[card] = by;
    LS.set(RANK_KEY[card], by);
    if (!cur?.rated) return;
    // Redrawing replaces the buttons, so keep focus on the one just pressed.
    const hadFocus = !!document.activeElement?.closest(`#${card}`);
    $(`#${card}`).outerHTML = card === 'topArtists'
        ? topCard(card, 'Top artists', cur.artists, cur.avg, stops())
        : topCard(card, 'Top albums', cur.albums, cur.avg, stops());
    if (hadFocus) document.querySelector<HTMLElement>(`#${card} [data-rank="${by}"]`)?.focus();
}

export async function renderStats(): Promise<void> {
    const n = ++seq;
    if (!S.source) scope = 'all';
    const listBtn = $('#scopeList');
    listBtn.hidden = !S.source;
    listBtn.title = S.source?.name ?? '';
    for (const b of $('#scope').querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.scope === scope));
    const body = $('#statsBody');
    tip(null);
    let ids: string[];
    let details: Map<string, Track>;
    if (scope === 'list') {
        details = mergeDetails(S.tracks);
        ids = S.tracks.map(t => t.id);
    } else {
        if (!saved) {
            body.innerHTML = '<div class="loading">Loading your saved songs…</div>';
            const all = await loadAllCached();
            if (n !== seq) return; // the scope changed or the screen reopened meanwhile
            saved = all;
        }
        // The open playlist first: it's the freshest copy of its songs.
        details = mergeDetails([...S.tracks, ...saved]);
        ids = [...details.keys(), ...Object.keys(S.ratings)];
    }
    cur = computeStats(ids, details, S.ratings);
    body.innerHTML = bodyHtml(cur);
    const box = document.getElementById('treemap');
    if (box) drawTreemap(box, cur.artists.slice(0, TREEMAP_MAX));
    if (picked && !cur.artists.some(a => a.name === picked)) picked = null;
    if (picked) { const p = picked; picked = null; pickArtist(p); }
}

/* ---- Helpers for the HTML ---- */

const num = (n: number) => n.toLocaleString();
const avgText = (a: number) => `${a.toFixed(1)}★`;
const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : 0);

/** The five rating colours as this theme draws them, for blending averages between them. */
const stops = () => [1, 2, 3, 4, 5].map(i => getComputedStyle(document.documentElement).getPropertyValue(`--r${i}`));
const fill = (rgb: [number, number, number]) => `rgb(${rgb.join(',')})`;

function hours(ms: number): string {
    const min = Math.round(ms / 60000);
    return min < 60 ? `${min} min` : `${Math.floor(min / 60)}h ${min % 60}m`;
}

const card = (title: string, inner: string, cls = '') => `<section class="st-card ${cls}"><h2>${title}</h2>${inner}</section>`;

/** A top-10 card with the ranking switch in its header. */
function topCard(id: TopCard, title: string, gs: Group[], mean: number, sts: string[]): string {
    const by = rankBy[id];
    const seg = RANKS.map(r => `<button data-rank="${r.by}" aria-pressed="${r.by === by}">${r.label}</button>`).join('');
    return `<section class="st-card" id="${id}"><div class="st-card-head"><h2>${title}</h2>
<div class="seg" role="group" aria-label="Rank ${title.toLowerCase()} by">${seg}</div></div>
${rankHtml(rank(gs, by, mean), by, sts) || note('Nothing yet.')}${note(RANKS.find(r => r.by === by)!.note)}</section>`;
}
const note = (text: string) => `<p class="st-note">${text}</p>`;

/** Five stars, read-only, in the rating's colour. */
const starRow = (r: number) =>
    `<span class="st-stars" style="--c:var(--r${r})" role="img" aria-label="${plural(r, 'star')}">${[1, 2, 3, 4, 5].map(i => STAR.replace('<svg', `<svg class="${i <= r ? 'on' : ''}"`)).join('')}</span>`;

function bodyHtml(s: Stats): string {
    if (!s.rated) {
        return `<div class="empty">${scope === 'list'
            ? `None of the songs in “${esc(S.source?.name)}” are rated yet. Rate a few and their stats show up here.`
            : 'You haven\'t rated any songs yet. Open a playlist, rate as you listen, and your stats show up here.'}</div>`;
    }
    const sts = stops();
    const tile = (big: string, label: string) => `<div class="st-tile"><b>${big}</b><span>${label}</span></div>`;
    const tiles = [
        tile(num(s.rated), `songs rated of ${num(s.total)}`),
        tile(avgText(s.avg), 'average rating'),
        tile(num(s.artists.length), s.artists.length === 1 ? 'artist' : 'artists'),
        tile(num(s.albums.length), s.albums.length === 1 ? 'album' : 'albums'),
        tile(hours(s.ms), 'of rated music'),
        ...TAGS.map(t => tile(num(s.tags[t.key]), `tagged ${esc(t.label.toLowerCase())}`))
    ].join('');

    const maxD = Math.max(...s.dist);
    const dist = [5, 4, 3, 2, 1].map(r => `<div class="st-dist">
<span class="st-lbl">${r}★</span><span class="st-track"><i style="width:${pct(s.dist[r - 1], maxD)}%;background:var(--r${r})"></i></span>
<span class="st-val">${num(s.dist[r - 1])} <small>${pct(s.dist[r - 1], s.rated)}%</small></span></div>`).join('');

    const missing = s.noDetails
        ? note(`${s.noDetails === 1 ? '1 rated song has' : `${num(s.noDetails)} rated songs have`} no saved details, so ${s.noDetails === 1 ? 'it\'s' : 'they\'re'} left out of the artist and album charts. Download ${s.noDetails === 1 ? 'its playlist' : 'their playlists'} to include ${s.noDetails === 1 ? 'it' : 'them'}.`)
        : '';
    const tm = s.artists.length
        ? `<div class="treemap" id="treemap"></div>${s.artists.length > TREEMAP_MAX ? note(`Showing the ${TREEMAP_MAX} artists with the most rated songs, of ${num(s.artists.length)}.`) : ''}${missing}
<div id="tmDetail" class="tm-detail" aria-live="polite"></div>`
        : note('No song details are saved for these ratings yet. Download their playlists to include them.');

    const maxDec = Math.max(0, ...s.decades.map(d => d.n));
    const decades = s.decades.map(d => `<div class="st-dist">
<span class="st-lbl">${d.name}s</span><span class="st-track"><i style="width:${pct(d.n, maxDec)}%;background:${fill(ratingColor(sts, d.avg))}"></i></span>
<span class="st-val">${num(d.n)} <small>${avgText(d.avg)}</small></span></div>`).join('');
    const noYear = s.noYear ? note(`${s.noYear === 1 ? '1 rated song has' : `${num(s.noYear)} rated songs have`} no release year. Reload a playlist from Spotify to add release years.`) : '';

    const maxM = Math.max(0, ...s.months.map(m => m.n));
    const months = s.months.map((m, i) => {
        const d = new Date(m.y, m.m);
        const name = d.toLocaleString('en', { month: 'short' });
        const label = `${d.toLocaleString('en', { month: 'long', year: 'numeric' })}: ${plural(m.n, 'song')} rated`;
        return `<div class="st-col" title="${label}" aria-label="${label}" role="img"><span class="st-bar"><small>${m.n || ''}</small><i style="height:${pct(m.n, maxM)}%"></i></span>
<span>${name}${i === 0 || m.m === 0 ? `<br>’${String(m.y).slice(2)}` : ''}</span></div>`;
    }).join('');

    return `<div class="st-tiles">${tiles}</div>
${card('Ratings', dist)}
${s.artists.length ? `<section class="st-card"><div class="st-card-head"><h2>Artists</h2>
<div class="seg" role="group" aria-label="Show artists as">${[['colours', 'Colours'], ['photos', 'Photos']].map(([v, l]) =>
        `<button data-look="${v}" aria-pressed="${(v === 'photos') === photoTiles}">${l}</button>`).join('')}</div></div>
<p class="st-sub">Size is rated songs, colour is average rating. Choose an artist for their albums and songs.</p>${tm}</section>` : card('Artists', `<p class="st-sub">Size is rated songs, colour is average rating. Choose an artist for their albums and songs.</p>${tm}`)}
${topCard('topArtists', 'Top artists', s.artists, s.avg, sts)}
${topCard('topAlbums', 'Top albums', s.albums, s.avg, sts)}
<div class="st-pair">
${card('By decade', (decades || note('None of these songs has a release year yet.')) + noYear)}
${card('Rating activity', s.months.length ? `<div class="st-colchart">${months}</div>` : note('These ratings have no dates.'))}
</div>`;
}

/** A ranked list; the bar is the song count against the top row when ranking by count, otherwise the average from 1★ to 5★. */
function rankHtml(gs: Group[], by: RankBy, sts: string[]): string {
    if (!gs.length) return '';
    const max = Math.max(...gs.map(g => g.n));
    return `<ol class="st-rank">${gs.map(g => `<li>
<span class="st-name"><b>${esc(g.name)}</b>${g.by ? `<small>${esc(g.by)}</small>` : ''}</span>
<span class="st-track"><i style="width:${by === 'count' ? pct(g.n, max) : pct(g.avg - 1, 4)}%;background:${fill(ratingColor(sts, g.avg))}"></i></span>
<span class="st-val">${avgText(g.avg)} <small>${plural(g.n, 'song')}</small></span></li>`).join('')}</ol>`;
}

function drawTreemap(box: HTMLElement, artists: Group[]): void {
    tip(null);
    const W = box.clientWidth, H = box.clientHeight;
    const sts = stops();
    const songs = cur?.songs ?? [];
    const ids = artistIdsByName(songs);
    // Laid out in pixels so rectangles come out near square, then placed in percent so a resize only stretches them.
    box.innerHTML = treemap(artists.map(a => a.n), W, H).map(({ i, x, y, w, h }) => {
        const a = artists[i];
        const rgb = ratingColor(sts, a.avg);
        const c = artistCover(songs, a.name);
        const id = ids.get(a.name) ?? '';
        // Spotify's small cover is 64px, so larger tiles (in device pixels) take the big one.
        const src = photoTiles ? photos[id] || (Math.max(w, h) * devicePixelRatio > 64 ? c.big : c.img) : '';
        const l = tileLabel(w, h, a.avg);
        const label = `${a.name}: ${plural(a.n, 'rated song')}, average ${a.avg.toFixed(1)} stars${c.album ? `, best album ${c.album}` : ''}`;
        return `<button class="tm-cell${l && !l.name ? ' only' : ''}${src ? ' pic' : ''}" data-a="${esc(a.name)}" data-id="${esc(id)}" data-al="${esc(c.album)}"
aria-pressed="${a.name === picked}" aria-controls="tmDetail" aria-label="${esc(label)}"
style="left:${(x / W) * 100}%;top:${(y / H) * 100}%;width:${(w / W) * 100}%;height:${(h / H) * 100}%;--c:${fill(rgb)};--t:${darkText(rgb) ? '#1D1A2C' : '#fff'}${l ? `;font-size:${l.px}px` : ''}">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async">` : ''}${l?.name ? `<b>${esc(a.name)}</b>` : ''}${l ? `<span>${l.text}</span>` : ''}</button>`;
    }).join('');
    if (photoTiles) loadPhotos([...box.querySelectorAll<HTMLElement>('.tm-cell')].map(b => b.dataset.id ?? ''));
}

/** Asks Spotify for the photos of drawn artists not yet known, swapping each into its tile as it arrives. */
function loadPhotos(ids: string[]): void {
    const want = ids.filter(id => id && !(id in photos) && !asked.has(id));
    if (!want.length) return;
    for (const id of want) asked.add(id);
    void getArtistImages(want, (id, url) => {
        photos[id] = url;
        LS.set(KEY.artistPhotos, photos);
        if (!url || !photoTiles) return;
        for (const b of document.querySelectorAll<HTMLElement>(`#treemap .tm-cell[data-id="${CSS.escape(id)}"]`)) {
            const img = b.querySelector('img') ?? b.insertAdjacentElement('afterbegin', Object.assign(document.createElement('img'), { alt: '', decoding: 'async' }))!;
            (img as HTMLImageElement).src = url;
            b.classList.add('pic');
        }
    });
}

/* ---- The treemap's tooltip: one element on <body>, so the card's rounded overflow can't clip it ---- */

let tipFor: HTMLElement | null = null;
let tipTimer = 0;

/** Shows the tooltip for a tile, or hides it (null). `brief` hides it again after a few seconds, for taps. */
export function tip(cell: HTMLElement | null, brief = false): void {
    clearTimeout(tipTimer);
    let el = document.getElementById('tmTip');
    const g = cell && cur?.artists.find(a => a.name === cell.dataset.a);
    tipFor = g ? cell : null;
    if (!g || !cell) { el?.classList.remove('on'); return; }
    if (!el) {
        el = Object.assign(document.createElement('div'), { id: 'tmTip', className: 'tm-tip' });
        el.setAttribute('role', 'tooltip');
        document.body.append(el);
    }
    el.innerHTML = `<b>${esc(g.name)}</b><span><i style="background:${cell.style.getPropertyValue('--c')}"></i>${avgText(g.avg)} · ${plural(g.n, 'rated song')}</span>${cell.dataset.al ? `<span>Best album: ${esc(cell.dataset.al)}</span>` : ''}`;
    placeTip();
    el.classList.add('on');
    if (brief) tipTimer = window.setTimeout(() => tip(null), 4000);
}

/** Puts the tooltip above its tile (below when there's no room), inside the viewport; hides it once the tile scrolls away. */
export function placeTip(): void {
    const el = document.getElementById('tmTip');
    if (!tipFor || !el) return;
    const r = tipFor.getBoundingClientRect(), t = el.getBoundingClientRect();
    const vw = document.documentElement.clientWidth, vh = innerHeight;
    if (!tipFor.isConnected || r.bottom < 0 || r.top > vh) return tip(null);
    const x = Math.min(Math.max(8, r.left + r.width / 2 - t.width / 2), vw - t.width - 8);
    const y = r.top - t.height - 6 >= 8 ? r.top - t.height - 6 : Math.min(r.bottom + 6, vh - t.height - 8);
    el.style.transform = `translate(${Math.round(x)}px,${Math.round(y)}px)`;
}

function detailHtml(s: Stats, name: string): string {
    const d = artistDetail(s.songs, name);
    const avg = d.songs.reduce((a, x) => a + x.r, 0) / d.songs.length;
    return `<h3>${esc(name)} <small>${plural(d.songs.length, 'rated song')}, average ${avgText(avg)}</small></h3>
<div class="st-cols">
<div><h4>Albums</h4><ul class="tm-list">${d.albums.map(a => `<li><span>${esc(a.name)}</span><span class="st-val">${avgText(a.avg)} <small>${plural(a.n, 'song')}</small></span></li>`).join('')}</ul></div>
<div><h4>Songs</h4><ul class="tm-list">${d.songs.map(x => `<li><span>${esc(x.t.name)}<small>${esc(x.t.album)}</small></span>${starRow(x.r)}</li>`).join('')}</ul></div>
</div>`;
}
