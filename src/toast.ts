import { $, esc } from './util';

interface ToastOpts {
    undo?: () => void;
    link?: string;
    linkText?: string;
}

let timer: number | undefined;

export function toast(msg: string, opts: ToastOpts = {}): void {
    const el = $('#toast');
    el.innerHTML = `<span>${esc(msg)}</span>`;
    if (opts.undo) {
        const undo = opts.undo;
        const b = document.createElement('button');
        b.textContent = 'Undo';
        b.onclick = () => { undo(); el.hidden = true; };
        el.append(b);
    }
    if (opts.link) {
        const a = document.createElement('a');
        a.href = opts.link; a.target = '_blank'; a.rel = 'noopener';
        a.textContent = opts.linkText || 'Open';
        el.append(a);
    }
    el.hidden = false;
    clearTimeout(timer);
    timer = window.setTimeout(() => { el.hidden = true; }, opts.undo || opts.link ? 8000 : 4500);
}
