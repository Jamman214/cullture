# Running and building

Run `npm install` once, then `npm run dev` and open `http://127.0.0.1:5173/`. You need Node.js; Vite and TypeScript are installed into the project by `npm install`.

| Command | What it does |
| --- | --- |
| `npm run dev` | Starts the Vite dev server, compiling TypeScript as it serves |
| `npm run typecheck` | Checks types with `tsc --noEmit` |
| `npm run build` | Type-checks, then writes static files to `dist/` |
| `npm run preview` | Serves the built `dist/` on port 4173 |

The server address is set in `vite.config.ts`. It listens on `127.0.0.1` because Spotify rejects `localhost` redirect URIs, and `strictPort` makes it fail rather than move to another port, which would break sign-in.

Every address you open the app at must be added as a Redirect URI in the Spotify Developer Dashboard, matching exactly. `base: './'` in the Vite config lets the built files be hosted in any folder; hosting outside your own machine needs HTTPS.

## Testing without Spotify

`npm run dev:mock` starts the app with a simulated Spotify instead of the real one, so testing doesn't use up Spotify's Development Mode limits. You don't need to sign in, and a **Test data** badge shows in the top bar.

The test library is built from a fixed seed, so it's the same on every run:

| Source | Songs | What it tests |
| --- | --- | --- |
| Liked Songs | 250 | Liked Songs loading and removal |
| Road trip | 45 | A small owned playlist |
| Late night | 120 | A medium owned playlist |
| Everything (600 songs) | 600 | Paging and long lists; also contains a duplicate, a local file, a podcast episode and an empty slot, which should all be skipped |
| Friends' mix | 30 | A collaborative playlist owned by someone else, which you can still edit |
| Today's Top Hits | 50 | A playlist you don't own, which should show greyed out |
| Empty playlist | 0 | The empty-list message |

Playback goes to a simulated **Test speaker** by default. A **Sleeping phone** device is also listed: it accepts commands but never plays, for testing a device that doesn't respond. Song 6 of Late night is relinked to a copy at song 21, the way Spotify does with songs unavailable in your country. On the Test speaker, no sound plays, but the position advances in real time and it moves to the next song when one ends, so you can test auto-advance by jumping near the end of a song.

Changes such as removed songs and new playlists are kept in memory, so reloading the page restores the original library. Ratings and settings are saved under a separate `culler-mock:` prefix, so test ratings never mix with your real ones.

Add `?chaos` to the address (`http://127.0.0.1:5173/?chaos`) to make about 1 in 8 requests fail with a 429 or 503 error, to check the app retries correctly.

The simulated server is in `src/mock/`, and normal builds leave it out entirely.
