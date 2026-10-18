# Quantum Golf bundle — the golf-only build for the iOS app

> A second, much smaller build of the pocket app that contains **Quantum Golf
> and nothing else**. The Fun with Quantum iOS app ships it inside its app
> bundle and shows it offline in a `WKWebView`.

## What it is

The same game as the site's golf mode with the on-screen editor
(`?mode=golf&input=manual` on entangible.org):

- the Bloch sphere / Q-sphere with the target ghost, goal line and evolution
  scrubber (`EvolvingState`);
- **tap to play** under the sphere: the hole's clubs as buttons (pick one as
  the tool), the circuit as a grid of 44 px cells (tap an empty cell to place,
  the line between two steps to insert; CX/CH: control ●, then a lit target
  ⊕), select + Delete / replace, ↶ undo, clear (+1) and a one-line score —
  every control named for VoiceOver, a spoken status after each change
  (details: [`pocket.md`](pocket.md), "Tap to play — golf");
- the library's gate palette (narrowed to the round's clubs) and circuit
  editor — on tablets and desktops below, as the drag-and-drop extra; hidden
  on phone layouts, where the tap grid is the circuit (same circuit state);
- the scorecard: 18 chips, par, strokes, fidelity, per-hole best, course clock,
  wipe (+1), "Show solution" with its price and the background optimal search;
- the classic 18 holes, random 18 courses with course codes (deal a new one,
  or type a code), scopes (full / one round);
- hole-in and course-end celebrations, as on the site;
- English and German (the site's `resolveLang`: `?lang=`, then the stored
  choice, then the browser language), with an EN/DE toggle in the toolbar.

What replaces the site header is a slim toolbar: **Course** (a sheet with
Classic 18 · New random 18 · Restart this course · enter a course code) and
**How to play** (short rules, a link to entangible.org). The host app's title
bar names the game, so the page has no title of its own.

The game logic is not a copy. `pocket-app/src/app/useGolfGame.ts` (the driver:
state, dealer, bests, course code, celebrations) and
`pocket-app/src/app/GolfBoard.tsx` (sphere well, course/scope pickers,
scorecard) are used by **both** the site shell (`App.tsx`) and the bundle's
shell (`pocket-app/src/golf/GolfApp.tsx`), so a golf fix lands in both.

## Build

```sh
cd pocket-app
npm ci
npm run build:golf                       # tsc + vite build --config vite.golf.config.ts
node scripts/check-golf-bundle.mjs       # the guard + size report (npm run check:golf)
```

Output: `pocket-app/dist-golf/` (git-ignored). The site build (`npm run build`
→ `dist/`) is untouched by it: the golf build has its own entry
(`pocket-app/golf.html` → `src/golf/main.tsx`), its own config
(`vite.golf.config.ts`) and its own plugins (`vite-plugins/golfBundle.ts`), and
needs no `prebuild` family fetch.

Build choices (all in `vite.golf.config.ts`):

- `base: './'` — every URL is relative; `golf.html` is emitted as `index.html`.
- One classic script: IIFE output, no lazy chunks, no modulepreload polyfill
  (which would call `fetch`), and `index.html` loads it with
  `<script defer src="./assets/…">` instead of `type="module"`. That is what
  lets the page run from `file://` and from a custom URL scheme alike.
- One stylesheet (`assets/style-*.css`), fonts as files: IBM Plex Sans
  400/600/700 + Plex Mono 400, **latin subset only** (English and German need
  nothing else), woff2 + woff.
- No `public/` copy (no manifest, icons, robots — the host app owns that).
- Hover policy: every `:hover` rule is moved under `@media (hover: hover)` —
  pocket.css, golf.css and the editor library's runtime-injected CSS alike —
  so a tap never leaves a button stuck in its hover look.

## Contents

```
index.html                 entry (top level of the bundle and of the tarball)
LICENSE                    Entangible's Apache-2.0 (copy of the repo LICENSE)
THIRD_PARTY_NOTICES.txt    every bundled third-party package + full licence text
assets/golf-<hash>.js      the app (React, react-dom, @qamposer/react, engine)
assets/style-<hash>.css    tokens + pocket.css + golf.css
assets/ibm-plex-*.woff2|woff
```

`THIRD_PARTY_NOTICES.txt` is generated at build time from the Rollup module
graph (every `node_modules` package with code or CSS in the output: its
`package.json` name / version / licence and its LICENSE file). Today that is
`@fontsource/ibm-plex-mono` and `@fontsource/ibm-plex-sans` (OFL-1.1),
`@qamposer/react` (Apache-2.0), `react`, `react-dom`, `scheduler` (MIT).

Size (Oct 2026): about 580 kB raw / 285 kB gzip in total, of which the script
is ~325 kB (~102 kB gzip), the stylesheet ~52 kB (~10 kB gzip) and the eight
font files ~165 kB. The guard prints the current numbers on every build.

## Exclusions — absent, not hidden

Not in the module graph at all: camera, vision pipeline, booth socket /
connect / camera role, composer hand-off and every QR code (incl. the
challenge-a-friend QR), Quantina, Quantum Runner, kiosk, debug, the guide, the
settings drawer, the welcome card, fullscreen / wake lock, analytics (no Umami
script, no event calls — `useGolfGame` takes an optional `onEvent` that the
bundle simply does not pass), the service worker, and any `fetch` /
WebSocket.

`scripts/check-golf-bundle.mjs` fails the build in CI when any of that comes
back: absolute `/assets` URLs, a non-relative or module script in
`index.html`, an `http(s)://` string in the JS outside its explicit allowlist
(the entangible.org link, React's error-text URL and XML namespace names),
`fetch(`, `new WebSocket`, `getUserMedia`, `serviceWorker`, `umami`, XHR /
beacon / EventSource / workers, a marker string of an excluded module, an
unguarded `:hover`, or a missing LICENSE / notices file. The matchers have
their own self-check (`src/golf/checkGolfBundle.test.ts`).

Links are fine: the host opens a plain `<a href="https://…">` in Safari. The
bundle has one (rules panel → entangible.org). A tap on a random course's code
copies `https://entangible.org/?course=<code>` (clipboard permitting), so the
friend it is for lands on the site's golf mode on the same holes.

## Storage

`localStorage` of the page's own origin (in the iOS app: `fwq://app`, separate
from entangible.org — nothing is shared with the site).

| Key | What | Same as the site? |
| --- | --- | --- |
| `entangible.pocket.golf.holes` | best strokes per classic hole (`{"1":3,…}`) | yes — written by the shared engine (`saveBest`) |
| `entangible.pocket.golf.revealed` | classic holes whose mid-hole solution was paid for | yes (`saveRevealed`) |
| `entangible.lang` | explicit EN/DE choice | yes (`shared/i18n`) |
| `entangible.golf.course` | `{"courseCode": "<base36>"\|null, "courseScope": "E"\|"M"\|"D"\|"X"\|null}` | **bundle only** — the site keeps these two fields inside `entangible.pocket.settings`, whose other fields (mode, camera, booth…) do not exist here |
| `qamposer-theme` | the editor library's theme (always dark) | yes (library) |

Random-course bests are session-only, exactly as on the site. `?course=<code>`
(and `&scope=E|M|D|X`) in the page URL override the stored course on load.
If storage throws (an opaque origin, storage disabled) the page falls back to
an in-memory store: everything plays, nothing is remembered.

## Release and pinning

Tag `golf-vN` (or `golf-vN-rc1` for a prerelease) on the commit to ship and
push the tag; `.github/workflows/golf-release.yml` (also runnable by hand with
an existing tag) builds with Node 20, runs the guard, and attaches:

- `entangible-golf-<short-sha>.tar.gz` — `pocket-app/dist-golf`, rooted so
  `index.html` is at the top level of the archive (no wrapping directory);
  deterministic (sorted, root-owned, fixed mtimes, `gzip -n`);
- `entangible-golf-<short-sha>.tar.gz.sha256` — `<hex>  <file name>`.

The release is never marked latest (`--latest=false`): `releases/latest`
must keep pointing at the printable kit (`kit-*`).

The iOS project pins the tarball by URL + sha256, e.g.

```
https://github.com/JanLahmann/entangible/releases/download/golf-v1/entangible-golf-<short-sha>.tar.gz
sha256 <hex from the .sha256 asset>
```

unpacks it into its `golf/` resource folder and loads
`fwq://app/golf/index.html` — **entry path `index.html`**.

## Testing locally

```sh
cd pocket-app
npm run build:golf && node scripts/check-golf-bundle.mjs
npx vite preview --config vite.golf.config.ts --port 4174   # → http://localhost:4174/
```

Prove the relative paths by serving the bundle from a nested path, the way
the app serves it under `golf/`:

```sh
mkdir -p /tmp/golfserve/some/nested && cp -R dist-golf /tmp/golfserve/some/nested/golf
python3 -m http.server 8000 --directory /tmp/golfserve
# open http://localhost:8000/some/nested/golf/index.html
```

or open `dist-golf/index.html` straight from disk (`file://`) — it loads too
(classic script, relative URLs). For the network rule, open the page with the
browser's network panel: the only requests are the files of the bundle
itself. Phone layouts: the device toolbar at 390×844 portrait / 844×390
landscape, and an iPad size; the layout is pocket.css's golf + build-on-screen
grid (phone stack, short-landscape two columns, tablet split), with tap to
play's adjustments: on a 390×844 portrait phone the sphere, the clubs, the
tap grid and the score are one screen — also in the iOS app's ~390×680 web
view (5-qubit hole: last row at 671 px) and on a 375×667 iPhone SE (658 px) —
and the library editor is hidden; in 844×390 landscape the
sphere and tap to play sit side by side in one full-width column. A hole can
be played by taps alone. After holing in, "Next hole" stands where the clubs
were (portrait 390×680, GHZ-4: at 371–415 px, under the scrubber 293–337 and
the goal line 340–358; landscape: 67–111 px), the evolution replays once
with its grid column marked, and the hole-in banner stays inside the sphere
panel (#13).

During development `npm run dev` also serves the bundle's entry at
`http://localhost:5173/golf.html` (site config, so without the hover rewrite).
