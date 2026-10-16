# Limits and common changes

## Limits

- **Spotify Premium** is needed for any playback control. Browsing and rating work without it, but songs won't play.
- **Five users.** Spotify apps in Development Mode allow up to 5 registered users; more needs Spotify's approval.
- **Owned playlists only.** Spotify won't return songs from playlists you neither own nor collaborate on.
- **Ratings are per browser and per address.** Use export and import to move them.
- **No monetisation while it streams.** Spotify's policy bars charging for apps that play or control playback.
- **Desktop browsers for in-tab playback.** Phones need the Spotify app as the playback device.

## Where to make common changes

| To change | Edit |
| --- | --- |
| Layout of a song row | `rowHtml` in `list.ts`, and `.row` grid columns in `styles.css` |
| Colours or rating colours | Tokens on `:root` in `styles.css` |
| A filter or sort option | `computeView` in `list.ts`, plus its control: rating chips in `CHIPS` in `list.ts`, status buttons and sort options in `index.html` |
| Keyboard shortcuts | `bindKeys` in `main.ts` |
| What Resume picks | `resumeTarget` in `list.ts` |
| What playback does when a song ends, or what a button does in each mode | `transition` in `playback.ts` |
| How far ahead playback queues, or skip rules | `orderFrom` in `player.ts` |
| Batch sizes or OAuth scopes | `config.ts` |
| A new Spotify request | Add a function in `spotify.ts` using `api()` |
| Cull thresholds | The `cullMax` and `keepMin` options in `index.html` |
| Dev server port | `vite.config.ts`, then update the Redirect URI to match |

Adding scopes means signing out and back in so Spotify asks for the new permissions.
