# Key user flows

## Start-up

1. `init` in `main.ts` wires up all events, then finishes sign-in if Spotify just redirected back.
2. With no Client ID or token, it shows the setup screen and stops.
3. Otherwise it loads your profile and playlists, starts loading the browser player in the background, and reopens the last playlist you used, or shows the picker.

## Rating session

1. **Resume** picks the first song in the current list that hasn't been played, or failing that the first unrated one.
2. Each song is marked played as soon as it starts, which updates its dot and the progress bar.
3. Pressing 1–5 or clicking a star rates it, with a short pop animation. With **Go to next song after rating** on, the next song starts 300 ms later.
4. Closing the page saves ratings immediately, so the next visit resumes where you stopped.

## Group rating

1. Select songs by clicking rows or checkboxes, shift-clicking for a range, or the header checkbox and **Select all shown** for everything filtered.
2. Click a star in the bulk bar, or **Clear ratings**.
3. `bulkRate` saves the previous ratings first, so the toast's **Undo** restores them exactly. The selection is then cleared.

Filters combine: search text, played status and rating chips all apply at once, so "Played" plus the "Unrated" chip finds songs you've heard but not rated. Clicking a segment of the progress bar sets the filters for that group.

## Culling

1. **Cull…** opens the dialog with a threshold of 1, 2 or 3 stars and a live count.
2. **Show them in the list** filters to those ratings, sorts lowest first and selects them all, so you can untick any before removing.
3. **Remove** (from the dialog or the bulk bar) asks for confirmation, then deletes in batches.
4. If a batch fails, songs already removed are taken off the list and the toast says how many got through. Ratings are never deleted by removal.

Removal is disabled for playlists you can't edit.

## Keepers playlist

The second half of the Cull dialog saves songs rated at or above 3, 4 or 5 stars to a new private playlist with the name you give. It's added to the picker, and the toast links to it in Spotify.

## Backup

**Export ratings** downloads `cullture-ratings-<date>.json` with every entry, plus song names for the open playlist so the file is readable. **Import ratings** merges a file in: for each song the more recent rating wins, and play history is kept from either side.
