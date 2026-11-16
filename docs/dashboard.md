# Stats dashboard

The **Stats** button in the top bar (on the playlist picker and the song list) opens a screen of charts about your ratings. **Back** returns to the screen you came from, scrolled to where you were. The player bar is hidden there, as on the picker, but playback, waiting for a rating and its beep carry on, and the keyboard shortcuts are off.

## Scope

A switch at the top picks which songs it covers:

- **All rated songs**: every song with a rating. Opening Stats from the picker starts here.
- **This playlist**: the open playlist's songs. Only shown while a playlist is open; opening Stats from the song list starts here.

## What it shows

1. **Tiles**: songs rated (of all songs in scope), average rating, artists, albums, total length of the rated songs, and how many songs have each tag (every tag in `TAGS` gets a tile).
2. **Ratings**: one bar per star, 5★ down to 1★, with counts and percentages.
3. **Artists**: a treemap, one rectangle per artist, sized by rated songs and coloured by average rating on the rating colour scale. Up to the 60 artists with the most rated songs; it says when there are more. Choosing an artist (click, tap, or Enter or Space) shows their albums with averages and their rated songs, best first.
   - **Labels**: the name and average ("4.6★") when the tile is at least 64×38 px; otherwise just the average, centred and sized to the tile (13px down to 8px), shortened to "4.6", then to the rounded digit "5" when that's all that fits (`tileLabel` in `stats.ts`). Only tiles under about 8 px get no label.
   - **Colours / Photos** switch in the card's header (`culler:artistTiles`, Colours by default). Switching redraws only the treemap; the open artist panel and focus stay. In Photos each tile shows the artist's Spotify photo, or, for artists with no known ID or no photo, the cover of their best album (highest average among their rated songs, ties to more songs; else any of their songs' cover; `artistCover`). With no artwork at all the tile keeps its colour. A dark gradient scrim sits under white, shadowed text, and the average sits on a pill in the rating colour, so the colour scale is still there. Small tiles use the 64px cover, larger ones the big one.
   - **Photos are fetched** only in Photos mode, only for the artists drawn, and only for IDs not already saved (`culler:artistPhotos`, which also records artists with no photo). The treemap draws at once with album covers, and each photo swaps in as it arrives, without redrawing. Failures are silent. Artist IDs are saved with songs (`artistIds`) since this was added, so a playlist saved earlier shows album covers until it's reloaded from Spotify.
   - **Tooltip**: name, average, rated songs and best album. It shows on mouse hover and on keyboard focus (Escape hides it); on a touch screen a tap shows it as well as opening the artist panel, and it goes on tapping elsewhere, after 4 seconds, or when the tile scrolls out of view. It's one element on `<body>` (so the card's rounded corners can't clip it), placed above the tile, or below when there's no room, inside the window. The tiles keep an `aria-label` with the same facts.
4. **Top artists** and **Top albums**: one top 10 each (on wide screens in two columns, 1–5 then 6–10), ranked by the switch in the card's header. Each card has its own switch and remembers its own choice (`culler:rankArtists`, `culler:rankAlbums`; an unknown stored value falls back to Weighted); changing one redraws only that card, so the other card, an open artist panel and the scroll position stay. A caption under the list says how it's ranked.
   - **Weighted** (default): `(n × avg + 5 × mean) / (n + 5)`, where `n` and `avg` are the group's rated songs and their average and `mean` is the average of every rated song in scope: like adding 5 songs at the overall average, so a few perfect songs don't outrank many highly rated ones. Ties go to more songs. The rows show the real average, so the order doesn't strictly follow it.
   - **Average**: the plain average, only groups with 3 or more rated songs; ties go to more songs.
   - **Most rated**: the most rated songs; ties go to the higher average.

   Each row shows the average and song count, and a bar coloured by the average. The bar's length is the average on the 1★–5★ scale, except under **Most rated**, where it's the song count against the top row. Phones hide the bar.
5. **By decade**: rated songs and their average per decade of release.
6. **Rating activity**: songs rated per month, up to the last 12 months that have ratings, with empty months shown.

With no ratings in scope it shows a sentence instead of empty charts.

## Where the data comes from

Ratings are keyed by track ID with no song details (see [state-and-data.md](state-and-data.md)), so the two halves come from different places:

- **Counts, averages, the rating bars and activity** come straight from the ratings, so every rated song counts.
- **Song details** (artists, album, length, year) come from the open playlist plus, for **All rated songs**, every saved playlist copy in IndexedDB and the `removed` record of culled songs (`loadAllCached` in `cache.ts`), merged by track ID.

A song with several artists counts once for each. An album is grouped by its name and first artist, since saved songs have no album ID.

## Notes on the screen

- **Rated songs with no saved details**: their playlist was never downloaded (or it was rated in another browser and imported). They count in the tiles and rating bars but not the artist, album and decade charts. Downloading their playlists from the picker fills them in.
- **No release year**: songs saved before release years were recorded. Reloading a playlist from Spotify (⋯ menu) adds them.
- **Joined artist names**: songs saved before artists were kept one by one count under the joined name ("A, B") until their playlist is reloaded.

## Code

`stats.ts` is pure: it takes song IDs, song details and ratings and returns the numbers, plus the squarified treemap layout, the colour scale, tile labels, each artist's stand-in cover and the name → artist ID lookup, tested in `test/stats.test.ts`. `dashboard.ts` loads the data for the scope, builds the HTML, and handles the scope switch, the ranking switch (`rank` in `stats.ts`), the Colours / Photos switch, photo loading (`getArtistImages` in `spotify.ts`), the tooltip and artist choice; `main.ts` wires the buttons and the tooltip's events, delegated on the stats screen.
