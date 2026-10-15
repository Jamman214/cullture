# Playback

Songs play either in the browser tab or on another Spotify device, and the app tracks which song is current either way. All of this is in `player.ts`.

## Two playback routes

| | This browser | Another device (phone, Spotify app) |
| --- | --- | --- |
| How it plays | Web Playback SDK creates a device called "Cullture (this browser)" | Web API Spotify Connect commands |
| Play, pause, seek | SDK methods | `PUT /me/player/...` requests |
| Learning the current song | SDK pushes `player_state_changed` events | Polls `GET /me/player` every 2.5 s, skipped while the tab is hidden |
| Needs | Premium, a desktop browser | Premium, Spotify open on that device |

`loadSDK` loads Spotify's script at start-up and waits up to 15 seconds for the browser player. If it's ready, it becomes the device unless you picked a different one last time. If it fails, for example without Premium, you choose a device from the device dialog instead.

## Play order

`playFrom(id)` starts a song and gives Spotify the next 50 songs to follow. The order comes from:

1. The play-selected list if one is set (from **Play selected**), otherwise the list as currently filtered and sorted.
2. If the song isn't in that list, the whole playlist in its own order.
3. Songs after the chosen one, minus already-rated songs when **Skip songs already rated** is on.

**Next** works this out again from the current song, so ratings given since playback started are respected. Spotify's own queue is only used when a song ends by itself. **Previous** goes back one in the list without skipping.

## Keeping in sync

`applyState` receives each state update from either route. It finds the matching song by ID, then by the original ID when Spotify has substituted a regional copy, then by URI. When the song changes it marks it played, highlights its row and scrolls it into view.

The seek bar doesn't ask Spotify for the position constantly. It stores the last known position and its time, and adds the time since while playing, redrawing every 500 ms.
