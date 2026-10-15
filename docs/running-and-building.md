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
