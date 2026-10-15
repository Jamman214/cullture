# Cullture: app structure and design

Cullture is a browser-only app for rating every song in a Spotify playlist or your Liked Songs from 1 to 5 stars, then removing the ones you don't want. It has no server: the browser talks to Spotify directly and stores everything else locally.

The stack is plain TypeScript and CSS, with no UI framework, bundled by Vite. The compiled app is three static files (HTML, one JS bundle, one CSS file) of about 54 kB in total.

## Main design decisions

- **No backend.** Sign-in uses Spotify's Authorization Code flow with PKCE, which needs no secret key. Each user registers their own Spotify app and pastes in its Client ID.
- **Ratings belong to songs, not playlists.** A rating is keyed by Spotify track ID, so a song rated in one playlist shows that rating everywhere.
- **Ratings live in the browser.** They're saved to localStorage, with JSON export and import as the backup and the way to move between browsers or addresses.
- **Spotify does the queueing.** When a song starts, the app hands Spotify the next 50 songs in order, so playback continues by itself even if the tab is in the background.
- **Nothing destructive without confirmation.** Removing songs always goes through a confirm dialog, and group ratings can be undone.

## Contents

| File | Covers |
| --- | --- |
| [running-and-building.md](running-and-building.md) | npm scripts, dev server address, Redirect URIs |
| [project-layout.md](project-layout.md) | Every file, what it owns, and how modules depend on each other |
| [state-and-data.md](state-and-data.md) | The app state object, rating entries, localStorage keys |
| [spotify-integration.md](spotify-integration.md) | Sign-in, the API client, endpoints, February 2026 API changes |
| [playback.md](playback.md) | Browser and remote playback, play order, staying in sync |
| [ui-and-rendering.md](ui-and-rendering.md) | Screens, static and generated HTML, rendering strategy |
| [user-flows.md](user-flows.md) | Start-up, rating, group rating, culling, keepers, backup |
| [visual-design.md](visual-design.md) | Colour tokens, typography, layout, small screens, accessibility |
| [keyboard-shortcuts.md](keyboard-shortcuts.md) | Every shortcut and when they apply |
| [limits-and-changes.md](limits-and-changes.md) | Known limits and where to make common changes |
