# Quantina — the unified Qoffee-Maker / quantum-mixer successor (task #35)

> Status: PLANNED (this document is the approved plan; no code yet). Phases
> QN0–QN5 below. Per Jan 2026-07-19: replace qoffee-maker and quantum-mixer
> with native Entangible functionality; **start with mixer** (display-only
> serving — cocktails/ice cream/juice), machine control (the Qoffee
> coffee-machine path) follows as a later phase. Name decided per Jan
> 2026-07-19: **Quantina** ("quantum cantina" — the service counter for
> anything), mode key `quantina`.

## Why

[Qoffee-Maker](https://qoffee-maker.org) and quantum-mixer share one idea:
**order something by programming a quantum computer.** N menu items are encoded
as the binary measurement outcomes of ⌈log₂ N⌉ qubits (Qoffee: 8 beverages ↔
3 qubits, `000`…`111`); the visitor builds a circuit until the histogram peaks
on the item they want, presses a button, ONE shot is measured, and the item that
comes out is served — by a Home-Connect coffee machine in Qoffee's case, by a
human mixing the cocktail/ice cream in the mixer case. The uncertainty is the
lesson: if your state isn't sharp, you get *a* drink, not *your* drink.

Both are standalone stacks maintained apart from Entangible — Qoffee-Maker is
a Dockerized Jupyter app (Home Connect env vars + `IBMQ_API_KEY`,
`qoffee.ipynb` in App Mode); quantum-mixer is its generalized successor, an
Angular 15 frontend + FastAPI backend whose YAML **usecases** (see the audit
section below) already carry the coffee / ice-cream / cocktail scenarios. Entangible already has everything expensive: circuit input
(tiles + camera, manual on-screen editing via `ManualEditSource`, replay),
ideal + noisy simulation in the browser, a shared histogram, kiosk/viewer/
camera/operator roles with WS state sync, a branding slot, attract mode, and
the take-it-home Composer transfer. What's missing is a thin layer: a menu
overlay, a one-shot "serve" event, a config format, and (later) machine
dispatch. So the successor is a **mode of Entangible One**, not a new app —
one more entry in the existing mode system, exactly like `golf`.

## Concept

- A **menu pack** (config package) defines a scenario: coffee, ice cream,
  cocktails, juice, anything — its items, pictures, branding, and (optionally)
  machine programs. Packs are data, not code; events/users make their own.
- A pack declares one of three **serve modes** (per Jan 2026-07-19 — a serve
  may pick multiple things, e.g. several ice-cream scoops or a cocktail's
  ingredients):
  - **`single`** (the Qoffee classic): item count fixes the qubit count
    ⌈log₂ N⌉ (≤ 5 — the board has 5 rows; 32 items max); one shot = one item.
  - **`shots`**: same encoding, but a serve draws k independent shots — k
    scoops, duplicates welcome ("2× vanilla, 1× mango" from a lopsided
    distribution is the honest outcome). k is visitor-choosable within
    pack-defined bounds — adopting quantum-mixer's proven
    `numMeasurements: {min, max, default}` shape.
  - **`subset`**: each item is bound to ONE qubit (≤ 5 items); a single shot's
    bitstring selects the subset — set bits are the ingredients in the glass.
    Superposition = "maybe"-ingredients; **entanglement = ingredients that
    always (or never) arrive together** — a Bell pair on gin+tonic is the
    best entanglement demo in the family.
- The menu view shows every item with its binary code and its **live
  probability** derived from the same probability vector the histogram shows
  (ideal, or noisy when a noise preset is active). In `subset` mode the
  per-item number is the qubit's *marginal* P(bit=1); `shots` mode shows the
  expected share of scoops.
- **Serve**: sample the active distribution (once, or k times). Reveal
  animation → order card ("You ordered: Cappuccino — `100` at 87%" / a scoop
  list / an ingredient list). With a noise preset on, shots are sampled from
  the *noisy* distribution — "real hardware might make you an espresso
  instead" is the best teaching moment in the family.
- Dispatch (later): the host can forward a serve to a real machine (Home
  Connect coffee machine, webhook for anything else) — operator-armed only.

## Menu packs (the config package)

One canonical **JSON wire schema** (TS types + validator in `shared/menu/`);
host-side packs are authored as TOML for consistency with `branding.toml` /
`layout.toml` and converted to the wire schema when served.

```toml
# menu/cocktails/pack.toml
id      = "cocktails"
title   = "Quantum Bar"
tagline = "Mix your drink with a quantum computer"

[serve]                      # optional; default mode = "single"
mode  = "single"             # "single" | "shots" | "subset"
shots = { min = 1, max = 5, default = 3 }   # mode = "shots" only; visitor picks
                                            # within bounds (quantum-mixer's
                                            # numMeasurements shape)

[theme]                      # optional branding overrides (CSS vars on tokens.css)
accent     = "#e91e63"
background = "bar.jpg"       # relative to the pack dir
logo       = "logo.svg"

[[link]]                     # optional footer links (quantum-mixer externalLinks)
name = "IBM Quantum"
url  = "https://www.ibm.com/quantum"

[[item]]
code     = "000"             # single/shots modes; subset mode uses `qubit = 0` instead
name     = "Tropical Sunrise"
subtitle = "orange · mango · grenadine"
image    = "sunrise.jpg"     # relative path; emoji used when absent
emoji    = "🍹"

[item.program]               # optional dispatch payload (QN4); Home Connect shape
key     = "ConsumerProducts.CoffeeMaker.Program.Beverage.Espresso"
options = [{ key = "ConsumerProducts.CoffeeMaker.Option.FillQuantity", value = 50 }]
# … one [[item]] per code
```

Rules (enforced by the loader, mirrored in tests):
- `single`/`shots`: `2 ≤ items ≤ 32`; qubit count = ⌈log₂ N⌉; codes are unique
  bitstrings of that width, using the same bit-order convention as the shared
  histogram labels (single source: `shared/display/outcomes.ts` — no second
  convention). `subset`: `2 ≤ items ≤ 5`, each item names a unique `qubit`
  0–4; qubit count = item count.
- Packs SHOULD fill all 2^q codes; unfilled codes are auto-padded with a
  "Surprise me ✨" house item (an honest answer to leftover amplitude — never
  re-roll, never remap: the measurement is the measurement).
- Images optional; every item has an emoji fallback so a pack with zero image
  files still looks intentional. Built-in packs are emoji+SVG-card only (no
  photo licensing burden); real photos arrive via custom packs.
- `theme` is optional; defaults inherit the standard Entangible look. Event
  branding (`branding.toml`) stays separate and composes: topbar = event,
  menu = pack.

**Built-in packs** (bundled in the app, work standalone/offline) — the three
real menus migrate from quantum-mixer's usecase YAMLs, names included:
`coffee` ("QoffeeMaker": Tea, Hot Chocolate, Espresso, Coffee, Cappuccino,
Latte Macchiato, Viennese Melange, Americano — with their Home Connect program
keys kept as dispatch payloads), `cocktails` ("Qocktail": Whiskey Sour →
Water), `icecream` ("IceQream": Strawberry → Salted Peanut, with the
delightful `111` = "Melted :(" — the house precedent for our auto-pad item),
plus `demo` (emoji food, 4 items / 2 qubits — the docs/test pack). Their icon
assets can be copied over (same author/family); until then the emoji
fallbacks apply.

**Custom packs**: host-side directory next to the other config files
(`menu/<id>/pack.toml` + images), served at `/api/menu/packs` (list) and
`/api/menu/pack/{id}` (wire JSON with image URLs, images streamed like
`/api/branding/logo`). Standalone app additionally accepts `?menupack=<url>`
pointing at a hosted wire-JSON pack (CORS permitting) — zero-install custom
menus at entangible.org.

## Architecture & touchpoints

Follows the noise-model / golf playbook: shared math + classPrefix components,
a mode, a layout field, an operator `select_*`, host validation + persistence.

- **`shared/menu/`** — `pack.ts` (types, validation, code↔item mapping,
  padding, serve modes), `sample.ts` (`sampleOutcome(probs, rng)` +
  `sampleShots(probs, k, rng)` + `marginals(probs)` for subset mode;
  injectable RNG — seeded mulberry32 in tests, crypto random in the UI),
  `builtinPacks.ts`,
  `MenuGrid.tsx` + `OrderCard.tsx` + `ServeReveal.tsx` (classPrefix-shared,
  themed via CSS vars).
- **Pocket (standalone)** — a Quantina surface like Golf's: pack picker in the
  settings drawer + `?menu=<id>` / `?menupack=<url>` URL params; local serve
  (no host). Wire count displays ⌈log₂ N⌉ via the existing `compact` wires.
- **Kiosk/booth** — new mode `quantina` in `layout.py` `MODE_PANELS`
  (`quantina: ["menu", "order", "results"]`): circuit stays on stage, sidebar
  shows the menu grid with live probabilities + the last order card. Attract
  mode gains a menu line ("Order your coffee with a quantum computer").
  Panel registry gains `menu` and `order` (unknown names already pass through
  clients — forward-compatible).
- **Protocol** (additive; `docs/protocol.md` ⇄ `ws/messages.ts` parity test
  updated in lockstep):
  - `layout` gains `menu: string | null` (active pack id).
  - client `select_menu {pack}` — operator-only, validated + persisted +
    replayed like `select_noise`.
  - client `serve {outcomes}` — sent by the serving surface (kiosk touch or
    `/debug`), operator-standing required; the sampler runs where the
    simulation runs (the client), the host is the authority that stamps and
    fans out. `outcomes` is a bitstring list: length 1 for `single`/`subset`,
    length k for `shots`.
  - server `served {seq, packId, outcomes, shotSource: 'ideal'|'noisy'}` —
    broadcast to all clients (viewers' phones show the same reveal, in sync),
    latest replayed to late joiners; clients resolve outcomes → items/scoop
    counts/ingredient subset via the shared pack mapping.
  - The existing policy test extends: `select_menu`/`serve` send-sites pinned
    to operator surfaces.
- **Host** — `layout.py` grows the `menu` field + `select_menu`; a new
  `menu.py` (pack directory loader/validator + REST endpoints); `ws_state.py`
  routes `serve` → `served`. All persistence TOML, same patterns.

## Machine dispatch (Qoffee parity — QN4)

Host-side only (secrets never reach the browser): `dispatch.py` with pluggable
adapters, configured per pack or in a host-level `dispatch.toml`:
- `log` (default) — serve events logged, nothing actuates. Dry-run for every
  pack.
- `webhook` — POST the `served` JSON to a configured URL. The universal
  adapter: cocktail robots, Home Assistant, GPIO bridges, ice-cream machines.
- `homeconnect` — the Qoffee path, mirroring quantum-mixer's working
  implementation: OAuth against the Home Connect API (login → callback →
  token), machine selection from the live appliance list (quantum-mixer
  exposes `selectedMachineHaId` as a schema-driven enum — our `/debug`
  dispatch card does the same), serve → `PUT
  /api/homeappliances/{haId}/programs/active` with the item's `program.key` +
  `options` (values coerced to int where the API demands it), and machine
  power-on ensured when dispatch is armed. Needs a developer-account client
  id; the Home Connect simulator works for CI-less manual testing.

Safety rails: dispatch is **disarmed by default**, armed from `/debug`
(operator token), auto-disarms after a configurable idle period; per-serve
cooldown (machine busy = queue nothing, show "machine is busy"); every
dispatch logged.

### Candidate equipment & scenarios (surveyed 2026-07-19)

Everything below reduces to the `webhook`/`mqtt` adapter + a small device
bridge — the pack's `program` payload stays generic, no schema changes.
Ranked by booth fitness:

- **Smart lights** (Philips Hue local REST, WLED REST/MQTT, DMX/Art-Net):
  outcome recolors the booth — instant, zero consumables. `subset` mode
  shines: **one lamp per qubit**; an entangled pair is two lamps that always
  switch together — a room-scale, photographable Bell demo. Candidate for a
  native adapter (trivial REST).
- **Receipt printer** (ESC/POS thermal): prints the order card — circuit,
  outcome, probabilities, Composer-transfer QR. Cheap, fast, every visitor
  leaves with a keepsake; useful for EVERY pack, drinks or not. Candidate
  for a native adapter, possibly pulled forward of QN4's machine work.
- **Candy/gummy dispenser** (Pi + servo per bin): faster and more hygienic
  than drinks, kid-friendly; `shots` mode = k candies.
- **Cocktail robot** (CocktailPi has a REST API; DIY pump rigs): `subset`
  mode maps **one pump per qubit** — a single shot literally mixes the
  drink, correlations included. The purest form of the ingredients idea.
- **Marble-run histogram** (servo gates, N clear tubes): each serve routes a
  marble; repeated serves physically accumulate the measured distribution.
  DIY build, unmatched pedagogy.
- **Prize locker / capsule machine** (relay board, one door per outcome);
  robot-arm bin picking (Dobot/LEGO SPIKE) as the flashy variant.
- **Quantum jukebox** (Sonos/Spotify API) — outcome picks the track; or
  MIDI/OSC with one note per qubit (`subset`): entangled notes always sound
  together.
- **Pen plotter** (AxiDraw API) drawing the outcome as a take-home sketch.
- **More Home Connect**: the same OAuth adapter reaches ovens/Cookit —
  booth-slow, but free if ever wanted.

## Phases (each independently demoable, repo convention)

1. **QN0 — menu core**: `shared/menu/` types + validator + padding + sampler +
   built-in packs; unit tests (validation matrix, seeded-RNG distribution
   sanity, histogram-parity of displayed probabilities). *Demo: none (pure
   lib), tests green.*
2. **QN1 — standalone Quantina (quantum-mixer replaced)**: pocket Quantina surface,
   pack picker + URL params, live menu probabilities, serve + reveal + order
   card, noise-aware shots. *Demo: entangible.org?menu=cocktails, build H⊗H⊗H,
   serve, get a random drink.*
3. **QN2 — booth Quantina**: `quantina` mode + panels, `select_menu`/`serve`/`served`
   protocol + host validation/persistence/replay, `/debug` pack control,
   viewer-synced reveals, attract-mode line, policy + parity tests.
   *Demo: `make demo`, switch mode to quantina from /debug, tiles pick the drink.*
4. **QN3 — custom packs**: host pack directory + REST, `?menupack=` remote
   packs, pack-authoring docs (`docs/menu-packs.md`) with the TOML schema and
   a checklist (image sizes, code table). *Demo: drop a folder, new themed
   menu appears without rebuilding.*
5. **QN4 — dispatch (Qoffee replaced)**: `dispatch.py` + `log`/`webhook`/
   `homeconnect` adapters, arming UX in `/debug`, cooldowns, docs incl. Home
   Connect setup. *Demo: serve → webhook fires / simulator brews.*
6. **QN5 — sunset the old repos** (upstream track, outside this repo):
   archive/deprecation notes in Qoffee-Maker and quantum-mixer READMEs
   pointing here; qoffee-maker.org redirect or banner; migrate any drink
   menus worth keeping into packs. Coordinate with Jan.

## Verification

- Unit: pack validation matrix (counts, dup codes/qubits, width, padding,
  serve-mode rules), sampler statistics under a seeded RNG (χ² sanity vs the
  input distribution; multi-shot draws), marginal math vs closed-form cases
  (Bell → both ingredients perfectly correlated), menu probabilities
  byte-identical to the histogram's vector, theme CSS-var application.
- Protocol: `messages.test.ts` parity vs `docs/protocol.md` (new messages);
  static policy test for the new `select_menu`/`serve` send-sites; host tests
  for validation/persistence/replay of `menu` + `served`.
- E2E without hardware: `make demo` replay drives a known circuit → menu
  probabilities match goldens; serve with seeded RNG → deterministic item in
  test mode.
- Manual: iPhone standalone (`?menu=icecream`), booth kiosk + viewer phones
  see the same reveal, dispatch dry-run log.

## Parity audit — what the old repos actually contain (read 2026-07-19)

**quantum-mixer** (`JanLahmann/quantum-mixer`; Angular 15 + FastAPI/Poetry,
Docker incl. arm64) is the generalized successor of Qoffee-Maker and the
direct ancestor of this design:

- **Usecases ≙ menu packs.** YAML per scenario in
  `quantum_mixer_backend/usecases/`: `id`, `name`, `description`,
  `bitMapping: [{bits, name, icon, key?, options?}]`, `numQubits`,
  `numMeasurements {min,max,default}`, `loginRequired`, `hasOrder`,
  `externalLinks`. Shipped: `Qocktail`, `IceQream`, `QoffeeMaker` (the coffee
  items carry Home Connect program keys + options, e.g. `FillQuantity: 50`).
  Icons under the backend's `public/` assets. → Adopted: schema fields
  (`shots {min,max,default}`, `[[link]]`, structured `program`), the three
  menus as built-in packs.
- **Multi-measurement was anticipated**: `numMeasurements` is a bounded,
  visitor-facing range (all shipped packs pin 1). → Our `shots` mode is its
  generalization; `subset` mode is new here.
- **Per-usecase preferences with JSON-schema-driven UI** (`/preferences`,
  `/preferences/schema`; machine picker enum built from the live Home Connect
  appliance list). → Folded into the QN4 `/debug` dispatch card.
- **Ordering** (`hasOrder`/`loginRequired`): OAuth login → callback → token,
  auto-select first coffee machine, `POST /order` → start program with
  key+options, machine power-on on preference save. → QN4 `homeconnect`
  adapter, host-side.
- **Execution**: `CircuitExecutor` with statevector (analytical), qasm
  simulator (800 shots), and FakeMontreal mock. → Entangible already exceeds
  this (exact density-matrix noise, four chip-generation presets, zero
  backend).
- **Custom Angular circuit composer** (catalogue / operation-details / drag
  UI). → Superseded by qamposer + tiles + `ManualEditSource`; nothing to port.
- Not present in either repo: sounds, leaderboards, or anything else outside
  menu/serve/order — no hidden features to chase.

**Qoffee-Maker** (`JanLahmann/Qoffee-Maker`; Dockerized Jupyter, `qoffee.ipynb`
in App Mode, env-var config incl. `IBMQ_API_KEY`): fully subsumed by the
quantum-mixer findings above; QN4 closes it out.

## Decisions (Jan 2026-07-19 — former open questions, all resolved)

1. **Serve authority in the booth**: as planned — the serving surface (kiosk
   touch or `/debug`) samples where the simulation runs; the host stamps
   `seq` and broadcasts `served` so every screen reveals the same result.
2. **Qubit count**: **3 qubits (8 items) is the default** — built-in packs
   are 3-qubit, and the UI is optimized for an 8-item menu. Packs may
   configure up to 5 qubits / 32 items (the board's limit); the loader
   accepts 2–32 items as specced.
3. **Home Connect**: the developer account / machine is available — QN4
   builds and tests the `homeconnect` adapter for real (simulator first).
4. **Name**: **Quantina** ("quantum cantina"), mode key `quantina`, packs =
   "menu packs"; built-ins keep their usecase names (QoffeeMaker, Qocktail,
   IceQream).
5. **No real-QPU serve** — real-backend runs are a rare case and stay out of
   the serve path. Instead, booth visitors take the circuit to THEIR OWN
   device and IBM Quantum account: the order card and viewer carry the
   existing Composer-transfer QR (`composerTransfer.ts` `?initial=` prefill
   — already shipped), so "run your drink order on real hardware" happens on
   the visitor's phone with their own (free) account. No API keys ever
   touch booth devices — consistent with the standing "NO in-app
   API-key/CRN entry" decision in design.md. QN2 makes sure the served/order
   card embeds that QR.
