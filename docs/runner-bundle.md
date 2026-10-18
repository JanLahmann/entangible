# Quantum Runner bundle — the runner-only build for the iOS app

> A third, small build of the pocket app that contains **Quantum Runner and
> nothing else**. The Fun with Quantum iOS app ships it inside its app bundle
> and shows it offline in a `WKWebView` at `fwq://app/runner/index.html`.
> The twin of the golf bundle ([`golf-bundle.md`](golf-bundle.md)); the game
> itself is described in [`runner.md`](runner.md).

## What it is

The same game as the site's runner mode (`?mode=runner` on entangible.org):
`RunnerGame` (`pocket-app/src/app/RunnerGame.tsx`) over the pure engine
(`shared/quantum/runner.ts`) — **one component for both**, so a Runner fix
lands in both. Lanes = basis states, the runner a ghost in every lane with
opacity = probability, gate buttons reshape the live state, coins bank the
expected value, obstacles measure; three lives, best score per level.

What replaces the site header is a slim toolbar
(`pocket-app/src/runner/RunnerApp.tsx`):

- **1 qubit / 2 qubits** — a change is a fresh run (the HUD's own level picker
  is off here); the choice is remembered;
- **DE / EN** — the site's `resolveLang`: `?lang=`, then the stored choice,
  then the device language (German if it starts with `de`), else English;
- **How to play** — short rules (EN / informal German "du"; one line says
  Reset is a real but non-unitary operation, not a gate: it forgets the
  state), the credit line
  "Based on Quantum Runner by the QAMPoser project." / "Nach Quantum Runner
  vom QAMPoser-Projekt.", and one plain link to entangible.org (the host opens
  it in Safari).

The host app's title bar names the game, so the page has no title of its own.

### Start, pause, resume

- Every run waits for **Start**, then a **3-2-1 countdown** (one number a
  second) — the app may load the page long before the player looks, and a
  VoiceOver user needs the moment to find the gates. "Run again" and a qubit
  change count down straight away (the tap was the user action).
- The run **pauses** when the page is hidden (`visibilitychange`), the window
  loses focus (`blur`), the page is put away (`pagehide`), on the ❚❚ button in
  the HUD, and while How to play is open. It **never resumes by itself**:
  Resume → the same countdown → go. The gate buttons are disabled while held.
  This lives in `RunnerGame`, so the site's runner pauses the same way (there
  without the Start gate: the site starts at once, as before).
- `prefers-reduced-motion`: no measurement flash, no coin float, the countdown
  numbers without their zoom — as on the site.

### VoiceOver

- Gate buttons are named: "Apply H to qubit 0", "Apply X to qubit 1",
  "Apply CX, control qubit 0, target qubit 1" (German "H auf Qubit 0
  anwenden", "CX anwenden, Steuer-Qubit 0, Ziel-Qubit 1"); the hearts read
  "3 lives", the pause button "Pause the run", the reset button "Reset the
  qubit to 0" / "Reset all qubits to 0" ("Qubit auf 0 zurücksetzen" / "Alle
  Qubits auf 0 zurücksetzen"); a reset is spoken as "Reset. |00⟩ 100%."
  (at once, like pause and game over: a user action is never queued).
- One polite live region (`role="status"`) speaks each coin and obstacle:
  what happened ("Coin, plus 0.5." / "Obstacle: hit, one life lost." /
  "Obstacle: passed."), the lane probabilities ("|00⟩ 50%, |11⟩ 50%" —
  lanes at 0 % left out), lives and score. **Throttled**: at most one line
  every 2 s; events in between are not queued — the latest waiting line is
  spoken when the gap ends.
- Spoken at once (not throttled): game over (score, distance, best / "New
  best!"), a new run ("New run, 2 qubits."), "Paused.", "Reset. |00⟩ 100%.", the countdown and
  "Go!".

### Layout (phones first)

One screen, no scrolling: toolbar, HUD (score · hearts · Reset · ❚❚), the
lane field (flexes: it takes whatever height is left, at least 6rem), the gate
grid — one row `X₀ H₀` at 1 qubit, two rows of three at 2 qubits (`X₀ H₀
CX 0→1` over `X₁ H₁ CX 1→0`). On a short landscape screen (≤ 450 px tall,
≥ 600 px wide) the grid sits beside the field, bottom right, so the lanes keep
the full height. Reset ("Reset |00⟩" / "Zurück auf |00⟩") lives in the HUD
next to ❚❚, the whole field away from the gates, so it is not hit by
accident. 44 px minimum for every control (gates 50 px at 1 qubit, 48 px at
2 qubits, 44 px on short landscape, 60 px on tablets), `touch-action:
manipulation` on all buttons (no 300 ms delay, no double-tap zoom; pinch-zoom
stays), safe-area insets on every edge (`viewport-fit=cover`), no text
selection / callout on long press. Measured in Chrome (built bundle in an
iframe of the exact size, EN and DE, Oct 2026; DE's longer "Zurück auf |00⟩"
changes only the reset width — 125 px vs 93 px):

| Viewport | Qubits | Gates (top–bottom, rows) | Field height (lane) | Lowest control | Page scroll |
| --- | --- | --- | --- | --- | --- |
| 390×680 (the app's web view) | 1 | 620–670, 1 row, 182×50 | 495 (246) | 670 | none |
| 390×680 | 2 | 568–670, 2 rows, 119×48 | 442 (110) | 670 | none |
| 375×667 (iPhone SE) | 1 | 607–657, 1 row, 175×50 | 482 (240) | 657 | none |
| 375×667 | 2 | 555–657, 2 rows, 114×48 | 429 (107) | 657 | none |
| 844×390 landscape | 1 | beside the field, 340–384, 83×44 | 278 (138) | 384 | none |
| 844×390 landscape | 2 | beside the field, 290–384, 2 rows, 83×44 | 278 (69) | 384 | none |
| 820×1180 (iPad) | 1 | 1104–1164, 1 row, 391×60 | 972 (485) | 1164 | none |
| 820×1180 | 2 | 1038–1164, 2 rows, 258×60 | 905 (226) | 1164 | none |

No gate or reset label is clipped (scrollWidth ≤ clientWidth) at any size;
the smallest control is 44 px tall. Reset sits 12 px left of ❚❚ and ≥ 400 px
above the gates on portrait phones.

## Build

```sh
cd pocket-app
npm ci
npm run build:runner                          # tsc + vite build --config vite.runner.config.ts
node scripts/check-bundle.mjs --bundle runner # the guard + size report (npm run check:runner)
```

Output: `pocket-app/dist-runner/` (git-ignored). Entry `pocket-app/runner.html`
→ `src/runner/main.tsx`; config `vite.runner.config.ts`. Both app bundles get
their config from `defineAppBundle` (`vite-plugins/appBundleConfig.ts`) and
their plugins from `vite-plugins/appBundle.ts`, so the build choices are
exactly golf's: `base: './'`, the entry emitted as `index.html`, one classic
IIFE script (`<script defer>`, no `type="module"`, no modulepreload polyfill,
no lazy chunks), one stylesheet, fonts as files (IBM Plex Sans 400/600/700 +
Mono 400, latin subset), no `public/` copy, every `:hover` moved under
`@media (hover: hover)`, and `LICENSE` + `THIRD_PARTY_NOTICES.txt` generated
from the bundled modules.

No `pocket.css`: the runner needs none of the site layout.
`src/runner/runner.css` carries the little base it needs (box sizing, page
fill, the `.pk-btn` look) plus the toolbar, sheet and phone sizing; the game's
own look is the shared `runnerGame.css`.

## Contents

```
index.html                 entry (top level of the bundle and of the tarball)
LICENSE                    Entangible's Apache-2.0 (copy of the repo LICENSE)
THIRD_PARTY_NOTICES.txt    every bundled third-party package + full licence text
assets/runner-<hash>.js    the app (React, react-dom, the runner engine, EN/DE copy)
assets/style-<hash>.css    tokens + runner.css + runnerGame.css
assets/ibm-plex-*.woff2|woff
```

Notices today: `@fontsource/ibm-plex-mono`, `@fontsource/ibm-plex-sans`
(OFL-1.1), `react`, `react-dom`, `scheduler` (MIT). No `@qamposer/react`: the
engine only borrows its gate *types*.

Size (Oct 2026): about 406 kB raw / 239 kB gzip in total, of which the script
is ~206 kB (~68 kB gzip), the stylesheet ~12 kB (~3 kB gzip) and the eight
font files ~165 kB. The guard prints the current numbers on every build.

## Exclusions — absent, not hidden

Not in the module graph at all: camera, vision pipeline, booth socket /
connect / camera role, composer hand-off and every QR code, Quantina, Quantum
Golf (board, tap to play, engine), the `@qamposer/react` editor library and
its theme, the spheres, kiosk, debug, the guide, the settings drawer, the
welcome card, fullscreen / wake lock, analytics (`RunnerGame` takes an
optional `onEvent`; the site passes `trackGame`, the bundle nothing, and the
component imports no analytics module), the service worker, and any `fetch` /
WebSocket.

`scripts/check-bundle.mjs --bundle runner` fails the build in CI when any of
that comes back — the same checks as golf (relative URLs, classic script, no
`fetch(` / WebSocket / XHR / beacon / workers / `serviceWorker` / `umami`,
the URL allowlist: entangible.org, React's error-text URL, XML namespaces;
hover policy; LICENSE + notices) with the runner's own marker list: every
site-only module plus golf (`pk-golf-goal`, `pk-course-pick`, `pk-gatebar`,
the golf engine) and the editor library (`circuit-editor`, `qamposer-theme`).
Self-check: `pocket-app/tests/checkBundle.test.ts` (incl. a synthetic runner
bundle that must pass, and fail with golf / editor / analytics / fetch in it).

## Storage

`localStorage` of the page's own origin (in the iOS app: `fwq://app`, separate
from entangible.org — nothing is shared with the site).

| Key | What | Same as the site? |
| --- | --- | --- |
| `entangible.pocket.runner.best` | best score per level (`{"1":12.3,"2":4.5}`) | yes — written by `RunnerGame` (`runnerBest.ts`) |
| `entangible.lang` | explicit EN/DE choice | yes (`shared/i18n`) |
| `entangible.runner.level` | last 1/2-qubit choice (`"1"`/`"2"`) | **bundle only** — the site's level lives in the runner HUD for the session |

If storage throws (an opaque origin, storage disabled) the page falls back to
an in-memory store (`src/bundle/ensureStorage.ts`, shared with golf):
everything plays, nothing is remembered.

## Release and pinning

Tag `runner-vN` (or `runner-vN-rc1` for a prerelease) on the commit to ship
and push the tag; `.github/workflows/runner-release.yml` (also runnable by
hand with an existing tag) builds with Node 20, runs the guard, and attaches:

- `entangible-runner-<short-sha>.tar.gz` — `pocket-app/dist-runner`, rooted so
  `index.html` is at the top level of the archive (no wrapping directory);
  deterministic (sorted, root-owned, fixed mtimes, `gzip -n`);
- `entangible-runner-<short-sha>.tar.gz.sha256` — `<hex>  <file name>`.

The release is never marked latest (`--latest=false`): `releases/latest`
must keep pointing at the printable kit (`kit-*`).

The iOS project pins the tarball by URL + sha256, e.g.

```
https://github.com/JanLahmann/entangible/releases/download/runner-v1/entangible-runner-<short-sha>.tar.gz
sha256 <hex from the .sha256 asset>
```

unpacks it into its `runner/` resource folder and loads
`fwq://app/runner/index.html` — **entry path `index.html`**.

## Testing locally

```sh
cd pocket-app
npm run build:runner && node scripts/check-bundle.mjs --bundle runner
npx vite preview --config vite.runner.config.ts --port 4175   # → http://localhost:4175/
```

Prove the relative paths by serving the bundle from a nested path, the way
the app serves it under `runner/`:

```sh
mkdir -p /tmp/runnerserve/app && cp -R dist-runner /tmp/runnerserve/app/runner
python3 -m http.server 8000 --directory /tmp/runnerserve
# open http://localhost:8000/app/runner/index.html
```

or open `dist-runner/index.html` straight from disk (`file://`). The network
panel shows only the bundle's own files (index, script, stylesheet, four
woff2). Phone sizes: the device toolbar at 390×680, 375×667, 844×390 and an
iPad size; a round can be played by taps alone, and switching tabs or
clicking outside the page pauses it.

During development `npm run dev` also serves the bundle's entry at
`http://localhost:5173/runner.html` (site config, so without the hover rewrite).

Tests: `src/runner/RunnerApp.test.tsx` (shell: no site chrome, Start +
countdown, qubit choice, How to play + credit + reset line, German, reset in
the HUD, the bundle's 44 px gate rules), and the gate grid / reset / pause /
VoiceOver / `onEvent` / best-score cases in `src/app/RunnerGame.test.tsx`;
the engine's reset and per-level pacing in `shared/quantum/runner.test.ts`.
