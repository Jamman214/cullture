/**
 * Runs before every test file: loads the real page into the simulated browser, so code that
 * looks up elements like #list or #dStars finds them.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Newer Node versions have their own localStorage, which stays switched off unless Node is
 * started with --localstorage-file, and it takes the place of the simulated browser's working
 * one. When that happens, put a simple in-memory one in its place.
 */
class MemoryStorage implements Storage {
    private items = new Map<string, string>();
    get length() { return this.items.size; }
    clear() { this.items.clear(); }
    getItem(key: string) { return this.items.get(key) ?? null; }
    key(i: number) { return [...this.items.keys()][i] ?? null; }
    removeItem(key: string) { this.items.delete(key); }
    setItem(key: string, value: string) { this.items.set(key, String(value)); }
}
let storageWorks = false;
try { storageWorks = typeof globalThis.localStorage?.clear === 'function'; } catch { /* not usable */ }
if (!storageWorks) {
    Object.defineProperty(globalThis, 'localStorage', { value: new MemoryStorage(), configurable: true, writable: true });
}

const html = readFileSync(resolve(__dirname, '../index.html'), 'utf8')
    .replace(/<script[^>]*src="\/src\/main\.ts"[^>]*><\/script>/, '');
document.documentElement.innerHTML = html.replace(/^[\s\S]*?<html[^>]*>/i, '').replace(/<\/html>\s*$/i, '');
