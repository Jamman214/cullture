# Visual design

The design centres on a five-step rating colour scale running from red at 1 star to teal at 5. The same colours appear on stars, filter chips and the progress bar, so a rating reads the same wherever you see it.

## Colour tokens

Every colour is a CSS variable on `:root` in `styles.css`. Dark values apply automatically when the system is in dark mode, and setting `data-theme="light"` on `<html>` forces light.

| Token | Light | Dark | Used for |
| --- | --- | --- | --- |
| `--bg` | #EEF0F5 | #17151F | Page background |
| `--surface` | #FFFFFF | #221F2F | Cards, rows on hover, player bar, dialogs |
| `--surface2` | #E4E6EE | #2D2941 | Image placeholders, play buttons |
| `--ink` | #1D1A2C | #EEEAF6 | Text, bulk bar background |
| `--muted` | #5E5A72 | #A49FB9 | Secondary text |
| `--line` | #D5D8E2 | #38334C | Borders |
| `--accent` | #4B3FD1 | #A096FF | Primary buttons, focus, current song |
| `--danger` | #C2363B | #F06A6E | Remove and Cull buttons |
| `--r1` | #D9474B | #F0686B | 1 star |
| `--r2` | #E07B3C | #F39A5B | 2 stars |
| `--r3` | #D29E1E | #F2C94C | 3 stars, logo star |
| `--r4` | #5FA445 | #8CCB6E | 4 stars |
| `--r5` | #16977F | #3CC7A8 | 5 stars |
| `--heard` | #9A95B0 | #6E6888 | Played but unrated |
| `--unheard` | #CDD0DC | #3A354F | Not played, empty stars |

Filled stars all take the colour of the rating, not a fixed gold: the selector `.stars[data-r="N"] .on` colours them. Stars are placed 5 to 1 in the HTML and shown with `row-reverse`, so CSS alone can light up every lower star on hover.

## Typography

One typeface, Bricolage Grotesque from Google Fonts, with a system sans-serif fallback. Body text is 15 px, headings are weight 800 with tight letter spacing and scale with the window from 26 to 38 px. Numbers use tabular figures so times line up.

## Layout

- Content is centred at up to 1180 px wide.
- The top bar, filter row and bulk bar stay pinned while the list scrolls; the player bar is fixed to the bottom.
- Song rows are a nine-column grid: checkbox, number, cover, title and artist, album, played dot, length, stars, play button.
- Shapes are rounded: pill buttons and chips, 10 px rows, 14–16 px cards and dialogs.
- Safe-area padding keeps content clear of phone notches and home bars.

## Small screens

Below 820 px wide, rows drop to five columns (checkbox, cover, title, stars, play), hiding number, album, played dot and length. The player bar stacks into rows with larger 44 px stars for touch, and the bulk bar stops being sticky.

## Motion and accessibility

The only animation is the star pop when rating, and it's switched off when the system asks for reduced motion. Keyboard focus shows a 2 px accent outline. Icon-only buttons and every star have labels for screen readers, and filter buttons expose their on or off state.
