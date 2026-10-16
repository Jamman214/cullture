# Playback

Songs play either in the browser tab or on another Spotify device. Playback is run by a state machine: all playback state is one value, and it only changes in one place.

## The state machine (playback.ts)

`S.pb` holds a `Playback` value:

| Field | Meaning |
| --- | --- |
| `mode` | `idle`, `playing`, `paused`, `waiting` or `ended` |
| `cur` | The current song's ID |
| `pos`, `at` | Position in ms, and when it was read; while playing, the real position is `pos + (now − at)` |
| `dur` | The current song's length |
| `alone` | Spotify was given only this song, so the app has to start the next one itself |
| `expect` | A song just requested from Spotify; reports about other songs are ignored until it starts, for up to 4 s |

| Mode | Means | Play button |
| --- | --- | --- |
| `idle` | Nothing has played yet | Starts at Resume |
| `playing` | A song is playing | Pauses |
| `paused` | Paused part-way through | Resumes |
| `waiting` | A song ended unrated with **Wait for a rating** on; the beep plays | Disabled |
| `ended` | A song ended with nothing to move on to, or the preference was turned off while waiting | Plays the next song |

`transition(state, event, context)` is the only code that decides what happens. It returns the new state and a list of effects for `player.ts` to carry out. It's a pure function: it doesn't touch the page, the network or the clock, so every playback rule is in one file and can be tested on its own.

**Events** are what can happen: `play`, `toggle`, `next`, `prev`, `seek`, `spotify` (a report from Spotify), `tick` (four times a second), `rated`, `prefsChanged` and `failed`.

**Effects** are what the machine asks for: `play`, `pause`, `resume` and `seek` (sent to Spotify), `played` (mark a song played), `toast`, and `later` (send an event after a delay, used for the short pause before auto-advancing).

**Context** is what the machine needs to know about the rest of the app, passed in fresh each time: the time, the **Wait for a rating** preference, whether a song is rated, song lengths, and which song comes next or before.

## How it's wired up (player.ts)

`dispatch(event)` is the one way to change playback:

1. It asks `transition` for the new state and effects.
2. It stores the new state in `S.pb`.
3. It runs each effect.
4. If anything changed, it redraws the affected song rows and calls `renderDeck`.

`renderDeck` draws the whole player bar from `S.pb`: song details, the stars, the play or pause icon, which buttons are disabled, the `waiting` class, the tab title, and the reminder beep. Because all of these are derived from the mode, they can't drift out of step. For example, the beep is on exactly when the mode is `waiting`.

Everything else in the app calls actions that send events: `playSong`, `togglePlay`, `goNext`, `goPrev`, `seekTo`, `seekBy`, `seekToFraction`, `rateCurrent`, `ratingsChanged` and `prefsChanged`.

## Two playback routes

| | This browser | Another device (phone, Spotify app) |
| --- | --- | --- |
| How it plays | Web Playback SDK creates a device called "Cullture (this browser)" | Web API Spotify Connect commands |
| Play, pause, seek | SDK methods | `PUT /me/player/...` requests |
| Learning what's playing | SDK pushes `player_state_changed` events | Polls `GET /me/player` every 2.5 s, skipped while the tab is hidden |
| Needs | Premium, a desktop browser | Premium, Spotify open on that device |

Both routes turn Spotify's reports into the same `spotify` event, after matching the song to the open list by ID, by the original ID when Spotify has swapped in a regional copy, or by URI.

`loadSDK` loads Spotify's script at start-up and waits up to 15 seconds for the browser player. If it's ready, it becomes the device unless you picked a different one last time.

## Play order

Starting a song gives Spotify the next 50 songs to follow, so it keeps going by itself. The order comes from:

1. The play-selected list if one is set (from **Play selected**), otherwise the list as currently filtered and sorted.
2. If the song isn't in that list, the whole playlist in its own order.
3. Songs after the chosen one, minus already-rated songs when **Skip songs already rated** is on.

With **Wait for a rating** on, Spotify is given only the one song, so it can't move on before you rate it.

## Spotting the end of a song

The app only needs to act at the end of a song when Spotify was given it alone or **Wait for a rating** is on; otherwise Spotify moves on by itself. Two signals count as the end:

- **The app's clock:** a `tick` while playing within 0.4 s of the end.
- **Spotify's report:** a "paused" report within 2 s of the end.

At the end, an unrated song with the preference on goes to `waiting`. Otherwise the next song starts, or the mode becomes `ended` if there isn't one.

While waiting, rating the song in any way moves on to the next song. Seeking back, with −15, M or the seek bar, replays from that point. Skipping forward does nothing, since the song is already over.

The seek bar is redrawn four times a second from the stored position and time, without asking Spotify.
