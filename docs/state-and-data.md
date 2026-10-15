# State and data model

All runtime state lives in one object, `S`, exported from `state.ts`. Modules read and change it directly, then call the render function for whatever they changed; there is no reactive framework.

| Field group | Fields | Meaning |
| --- | --- | --- |
| Account | `me`, `sources`, `source` | Signed-in user, the playlist list, the open playlist |
| Songs | `tracks`, `byId`, `view` | All loaded songs, a lookup by ID, the filtered and sorted list on screen |
| Selection | `sel`, `anchor`, `queue` | Ticked song IDs, the last clicked row for shift-select, an optional play-selected order |
| Filters | `filter.q`, `filter.status`, `filter.ratings`, `filter.sort` | Search text, played status, rating chips, sort order |
| Ratings | `ratings`, `opts` | Saved ratings and play history; the two player options |
| Playback | `cur`, `playing`, `pos`, `posAt`, `dur`, `dragging` | Current song, play state, last known position and when it was read |
| Devices | `sdk`, `sdkDevice`, `deviceId`, `deviceName`, `pollTimer` | Browser player, chosen device, polling timer for remote devices |

A `Track` is trimmed from Spotify's song object to `id`, `uri`, `name`, `artists`, `album`, two image URLs, `dur`, `added` and `idx` (its position in the playlist). Local files, podcast episodes and duplicate songs are skipped when loading.

Each rating entry is `{ r, t, p }`: the rating from 1 to 5, when it was rated, and when the song was first played (both in milliseconds). An entry is deleted once it has neither a rating nor a play. A song counts as played if it has either.

## Saved data in localStorage

| Key | Holds |
| --- | --- |
| `culler:ratings` | Every rating entry, keyed by track ID (saved 250 ms after the last change, and on page close) |
| `culler:opts` | Skip-rated and auto-advance settings |
| `culler:token` | Access token, refresh token, expiry time |
| `culler:clientId` | Your Spotify app's Client ID |
| `culler:device`, `culler:sdkDevice` | Last chosen playback device and the browser player's ID |
| `culler:lastSource` | The playlist to reopen on next visit |
| `culler:prog:<id>` | Rated count and total per playlist, for the picker's progress bars |
| `culler:verifier`, `culler:state` | Temporary sign-in values, deleted once sign-in finishes |

The keys keep the `culler:` prefix from before the rename, so data saved by earlier versions still loads. localStorage is separate for each address, including the port.
