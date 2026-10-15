# Spotify integration

Cullture uses three Spotify services: the Accounts service for sign-in, the Web API for data and playback control, and the Web Playback SDK for playing in the browser.

## Sign-in (auth.ts)

1. `login` creates a random 64-character verifier and a 16-character state value, stores both, and sends you to Spotify's authorise page with the SHA-256 hash of the verifier.
2. Spotify redirects back with a code. `handleRedirect` checks the state value matches, swaps the code and verifier for tokens, and clears the address bar.
3. `getToken` returns the stored access token, refreshing it 60 seconds before it expires. Refreshes are shared, so several requests at once only refresh once. A failed refresh deletes the token and throws `SignedOutError`, which sends you back to the setup screen.

The scopes requested are listed in `config.ts`: reading and changing your library and playlists, playback control, `streaming` for the browser player, and your profile.

## API client (api.ts)

`api(path, { method, body, query })` accepts a path or one of Spotify's full `next` page links, and returns parsed JSON (or `null` for empty responses). It handles errors itself:

- **401:** refreshes the token once and retries.
- **429:** waits for Spotify's `Retry-After` time, at most 30 seconds, and retries.
- **5xx:** retries twice after 700 ms.
- **Other errors:** throws `SpotifyError` with Spotify's message and the HTTP status.

It gives up after six attempts in total.

## Endpoints used

| Task | Endpoint | Module |
| --- | --- | --- |
| Profile | `GET /me` | spotify.ts |
| Playlists | `GET /me/playlists` | spotify.ts |
| Liked Songs | `GET /me/tracks` | spotify.ts |
| Playlist songs | `GET /playlists/{id}/items` | spotify.ts |
| Remove from playlist | `DELETE /playlists/{id}/items` | spotify.ts |
| Remove from Liked Songs | `DELETE /me/library`, falling back to `DELETE /me/tracks` | spotify.ts |
| Create playlist | `POST /me/playlists`, falling back to `POST /users/{id}/playlists` | spotify.ts |
| Add to playlist | `POST /playlists/{id}/items` | spotify.ts |
| Devices | `GET /me/player/devices` | spotify.ts |
| Play, pause, seek | `PUT /me/player/play`, `/pause`, `/seek` | player.ts |
| Remote playback state | `GET /me/player` | player.ts |

Lists are read 50 at a time. Removals and additions go in batches of 10 for playlists and 40 for Liked Songs.

## February 2026 API changes

Spotify changed the Web API for apps in Development Mode in February 2026, and the code allows for it:

- Playlist contents moved from `/tracks` to `/items`, and each entry's song from `track` to `item`. The loader reads either.
- Only playlists you own or collaborate on return their songs. Others show greyed out on the picker.
- Library removal moved to `/me/library`. The fallbacks keep older endpoints working if the new ones fail.
- Per-request limits were lowered, hence the small write batches.
