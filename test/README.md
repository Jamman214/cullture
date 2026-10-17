# Tests

Unit tests for Cullture, using [Vitest](https://vitest.dev). They run in jsdom, a simulated browser, with the real `index.html` loaded, so nothing touches Spotify.

```bash
npm test             # run everything once
npm run test:watch   # re-run as you edit
```

| File | Covers |
| --- | --- |
| `playback.test.ts` | The playback state machine: every event in every mode, the end of a song, waiting for a rating, Spotify's reports |
| `player.test.ts` | What gets sent to Spotify (play order, skipping rated songs, one song at a time when waiting), rating and tagging the playing song |
| `list.test.ts` | Filtering, sorting, Random order, Resume, and selecting with clicks, Ctrl, Shift and checkboxes |
| `state.test.ts` | Ratings, play history and tags, and when saved entries are removed |
| `api.test.ts` | The Web API client: signing in again on 401, waiting on 429, retrying server errors |
| `spotify.test.ts` | Loading songs and playlists: paging, and skipping local files, episodes and duplicates |
| `cull.test.ts` | Importing ratings: which rating wins, merging tags |
| `cache.test.ts` | Spotting playlists that changed on Spotify since they were saved |
| `tags.test.ts`, `util.test.ts` | Tags and their filter states; small helpers |

`setup.ts` loads the page before each test file, and `helpers.ts` resets the app's state between tests.

Not covered: the Web Playback SDK and sign-in, which need a real Spotify account, and saving playlists in IndexedDB, which jsdom doesn't have. Test mode (`npm run dev:mock`) is the way to check those by hand.
