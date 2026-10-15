# UI structure and rendering

The page is one HTML file with three screens, and `show()` in `views.ts` displays one at a time by toggling `hidden`.

| Screen | Element | Shown when | Also shown |
| --- | --- | --- | --- |
| Setup | `#setup` | No Client ID or not signed in | — |
| Picker | `#picker` | Signed in, choosing a playlist | ⋯ menu |
| Workspace | `#work` | A playlist is open | Change playlist, Cull…, ⋯ menu, player bar |

The workspace stacks, top to bottom: the summary (title, counts, Resume button, progress bar), the sticky filter row, the bulk action bar when songs are selected, and the song list. The player bar is fixed to the bottom of the window. Four dialogs sit outside the screens: Cull, confirm, device choice, and a toast for messages.

## Static and generated HTML

`index.html` holds everything with a fixed shape. Anything built from data is made as HTML strings in TypeScript and inserted with `innerHTML`, with every Spotify-supplied value passed through `esc()` first.

| Generated part | Function | File |
| --- | --- | --- |
| Song rows | `rowHtml` | list.ts |
| Progress bar, legend, Resume label | `renderSummary` | list.ts |
| Rating filter chips | `renderFilters` | list.ts |
| Playlist cards | `renderPicker` | views.ts |
| Loading and error messages | `openSource` | views.ts |
| Setup warnings | `showSetup` | views.ts |
| Device list | `openDevices` | player.ts |
| Star buttons | `starsHtml` | util.ts |
| Notifications | `toast` | toast.ts |

## Rendering strategy

- **Full redraw** (`renderList`) recomputes the filtered list and rebuilds every row. It runs when filters, sorting or the song set change, and after group actions.
- **Single-row update** (`updateRow`) replaces one row when a song is rated or starts playing. The list isn't refiltered, so a song you just rated doesn't vanish from an "Unrated" filter while you're looking at it.
- **Selection sync** (`syncSelDom`) only flips checkbox and highlight state on existing rows.

Rows use CSS `content-visibility: auto`, so the browser skips laying out off-screen rows, which keeps playlists of several thousand songs responsive without a virtual list.

Events use delegation: one click listener on `#list` handles stars, play buttons, checkboxes and row clicks for every row, so redrawing rows never needs listeners re-attached. Elements are found with `$()`, which throws if an ID is missing, so a typo in the HTML fails loudly at start-up.
