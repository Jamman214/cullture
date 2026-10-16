/** querySelector that throws if the element is missing, so callers get a non-null type. */
export function $<T extends Element = HTMLElement>(sel: string, root: ParentNode = document): T {
    const el = root.querySelector<T>(sel);
    if (!el) throw new Error(`Missing element: ${sel}`);
    return el;
}

export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

export const LS = {
    get<T>(k: string, d: T): T {
        try { const v = localStorage.getItem(k); return v == null ? d : (JSON.parse(v) as T); } catch { return d; }
    },
    set(k: string, v: unknown, onError?: () => void): void {
        try { localStorage.setItem(k, JSON.stringify(v)); } catch { onError?.(); }
    },
    del(k: string): void {
        try { localStorage.removeItem(k); } catch { /* storage unavailable */ }
    }
};

const ESC: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s: unknown) => String(s ?? '').replace(/[&<>"']/g, c => ESC[c]);

export const fmt = (ms: number) => {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
};

export const chunk = <T>(a: T[], n: number): T[][] => {
    const o: T[][] = [];
    for (let i = 0; i < a.length; i += n) o.push(a.slice(i, i + n));
    return o;
};

/** "just now", "5 min ago", "3 hours ago", "2 days ago". */
export function ago(ms: number): string {
    const min = Math.round((Date.now() - ms) / 60000);
    if (min < 1) return 'just now';
    if (min < 60) return `${min} min ago`;
    const h = Math.round(min / 60);
    if (h < 24) return `${plural(h, 'hour')} ago`;
    return `${plural(Math.round(h / 24), 'day')} ago`;
}

export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

export const STAR = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.8l2.8 5.9 6.4.8-4.7 4.4 1.2 6.4L12 17.2l-5.7 3.1 1.2-6.4L2.8 9.5l6.4-.8z"/></svg>';
export const PLAY_SVG = '<svg viewBox="0 0 24 24"><path fill="currentColor" d="M7 4v16l13-8z"/></svg>';
export const PLAY_PATH = '<path fill="currentColor" d="M7 4v16l13-8z"/>';
export const PAUSE_PATH = '<path fill="currentColor" d="M6 4h4v16H6zM14 4h4v16h-4z"/>';

/** Star buttons in DOM order 5..1; the container uses row-reverse so CSS hover lights lower stars. */
export function starsHtml(r: number): string {
    let h = '';
    for (let n = 5; n >= 1; n--) {
        h += `<button class="star${r >= n ? ' on' : ''}" data-v="${n}" aria-label="Rate ${plural(n, 'star')}">${STAR}</button>`;
    }
    return h;
}
