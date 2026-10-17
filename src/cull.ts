/** The Cull dialog (remove low-rated songs, save keepers), confirmations, and ratings backup. */
import { messageOf } from './api';
import { saveCached } from './cache';
import { TAGS } from './tags';
import { renderList } from './list';
import { renderDeck } from './player';
import { S, rOf, saveRatings, setTracks } from './state';
import { createPlaylist, removeFromSource } from './spotify';
import { toast } from './toast';
import type { Ratings } from './types';
import { $, plural } from './util';

export function confirmBox(title: string, text: string, ok: string): Promise<boolean> {
    const d = $<HTMLDialogElement>('#confirmDlg');
    const yes = $<HTMLButtonElement>('#cfYes');
    const no = $<HTMLButtonElement>('#cfNo');
    $('#cfTitle').textContent = title;
    $('#cfText').textContent = text;
    yes.textContent = ok;
    d.showModal();
    return new Promise(res => {
        const done = (v: boolean) => { yes.onclick = no.onclick = null; if (d.open) d.close(); res(v); };
        yes.onclick = () => done(true);
        no.onclick = () => done(false);
        d.addEventListener('cancel', () => done(false), { once: true });
    });
}

const srcLabel = () => (S.source?.liked ? 'Liked Songs' : `“${S.source?.name}”`);
const sel = (id: string) => $<HTMLSelectElement>(id);

export const cullIds = () => {
    const max = Number(sel('#cullMax').value);
    return S.tracks.filter(t => { const r = rOf(t.id); return r && r <= max; }).map(t => t.id);
};
const keepIds = () => {
    const min = Number(sel('#keepMin').value);
    return S.tracks.filter(t => rOf(t.id) >= min).map(t => t.id);
};

export function refreshCull(): void {
    if (!S.source) return;
    const c = cullIds().length;
    const k = keepIds().length;
    const go = $<HTMLButtonElement>('#cullGo');
    $('#cullCount').textContent = plural(c, 'song');
    go.textContent = `Remove ${plural(c, 'song')}`;
    go.disabled = !c || !S.source.editable;
    $('#cullNote').textContent = S.source.editable
        ? `Removes them from ${srcLabel()} on Spotify.`
        : 'You can only remove songs from playlists you own or collaborate on.';
    $('#keepCount').textContent = plural(k, 'song');
    $<HTMLButtonElement>('#keepGo').disabled = !k;
}

export function openCull(): void {
    if (!S.source) return;
    $('#cullName').textContent = S.source.liked ? 'Liked Songs' : S.source.name;
    $<HTMLInputElement>('#keepName').value = `${S.source.name} (keepers)`;
    refreshCull();
    $<HTMLDialogElement>('#cullDlg').showModal();
}

/** Shows the songs that would be culled, selected, so they can be reviewed first. */
export function reviewCull(): void {
    const max = Number(sel('#cullMax').value);
    S.filter.ratings = new Set(Array.from({ length: max }, (_, i) => String(i + 1)));
    S.filter.status = 'all';
    S.filter.q = '';
    S.filter.sort = 'rasc';
    $<HTMLInputElement>('#q').value = '';
    S.sel = new Set(cullIds());
    $<HTMLDialogElement>('#cullDlg').close();
    renderList();
}

export async function removeTracks(ids: string[]): Promise<void> {
    const src = S.source;
    if (!src) return;
    const label = srcLabel();
    const ok = await confirmBox(
        `Remove ${plural(ids.length, 'song')}?`,
        `They'll be removed from ${label} on Spotify. Your ratings stay saved, and you can re-add songs from Spotify later.`,
        'Remove'
    );
    if (!ok) return;

    const uris = ids.map(id => S.byId.get(id)?.uri).filter((u): u is string => !!u);
    const gone = new Set<string>();
    toast(`Removing ${plural(uris.length, 'song')}…`);
    try {
        await removeFromSource(src, uris, (part, snapshot) => {
            part.forEach(u => gone.add(u));
            if (snapshot) src.snapshot = snapshot;
        });
    } catch (e) {
        toast(`Stopped after removing ${gone.size} of ${uris.length}: ${messageOf(e)}`);
    }
    setTracks(S.tracks.filter(t => !gone.has(t.uri)));
    // Keep the saved copy in step, so it isn't flagged as changed on Spotify next time.
    if (src.total != null) src.total = Math.max(0, src.total - gone.size);
    void saveCached(src, S.tracks);
    renderList();
    if (gone.size === uris.length) toast(`Removed ${plural(gone.size, 'song')} from ${label}.`);
}

export async function saveKeepers(): Promise<void> {
    if (!S.me || !S.source) return;
    const name = $<HTMLInputElement>('#keepName').value.trim() || 'Keepers';
    const btn = $<HTMLButtonElement>('#keepGo');
    const uris = keepIds().map(id => S.byId.get(id)!.uri);
    btn.disabled = true;
    try {
        const pl = await createPlaylist(S.me, name, uris);
        S.sources.splice(1, 0, { id: pl.id, name, img: null, total: uris.length, readable: true, editable: true });
        $<HTMLDialogElement>('#cullDlg').close();
        toast(`Created “${name}” with ${plural(uris.length, 'song')}.`, { link: pl.external_urls?.spotify, linkText: 'Open in Spotify' });
    } catch (e) {
        toast('Couldn\'t create the playlist: ' + messageOf(e));
    } finally {
        btn.disabled = false;
    }
}

export function exportRatings(): void {
    const names: Record<string, string> = {};
    for (const t of S.tracks) names[t.id] = `${t.artists} – ${t.name}`;
    const data = {
        app: 'cullture',
        version: 1,
        exported: new Date().toISOString(),
        ratings: Object.fromEntries(Object.entries(S.ratings).map(([id, e]) => [id, { ...e, ...(names[id] ? { song: names[id] } : {}) }]))
    };
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' }));
    a.download = `cullture-ratings-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

/** Merges an export into current ratings; the more recent rating wins for each song. */
export async function importRatings(file: File): Promise<void> {
    try {
        const data = JSON.parse(await file.text()) as { ratings?: Ratings } | Ratings;
        const src: Ratings = ('ratings' in data && data.ratings && typeof data.ratings === 'object')
            ? (data.ratings as Ratings) : (data as Ratings);
        let n = 0;
        for (const [id, e] of Object.entries(src)) {
            if (!e || typeof e !== 'object') continue;
            const cur = S.ratings[id] || {};
            const merged = { ...cur };
            if (e.r && e.r >= 1 && e.r <= 5 && (!cur.r || (e.t || 0) > (cur.t || 0))) { merged.r = e.r; merged.t = e.t; }
            if (e.p && !cur.p) merged.p = e.p;
            for (const t of TAGS) if (e[t.key]) merged[t.key] = true;
            S.ratings[id] = merged;
            n++;
        }
        saveRatings();
        if (S.source) { renderList(); renderDeck(); }
        toast(`Imported ratings for ${plural(n, 'song')}.`);
    } catch {
        toast('That file isn\'t a Cullture ratings export.');
    }
}
