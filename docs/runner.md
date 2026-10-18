# Quantum Runner — the measurement game (task #52)

> Status: IMPLEMENTED. Pocket-only mode `runner`. Engine
> `shared/quantum/runner.ts`; UI `pocket-app/src/app/RunnerGame.tsx` +
> `runnerGame.css`. Based on **Quantum Runner by the QAMPoser project** (the
> co-developer's Flappy-style lane game at
> `qamposer-usecases/quantum-runner`), re-imagined in Entangible idioms.

## Why

Quantum Runner turns the one idea most games skip — **measurement** — into the
core mechanic. Where the upstream toy scores by discretizing the probability
distribution into "lanes the runner is in", the Entangible version keeps the
state quantum for as long as it can and only collapses it when the game forces a
measurement. You feel the difference between a superposition that quietly banks
partial credit and a projector that snaps you into one branch and takes a life.

## How it plays

- **Lanes are basis states.** Level 1 is 1 qubit → 2 lanes (`|0⟩`, `|1⟩`);
  level 2 is 2 qubits → 4 lanes (`|00⟩`, `|01⟩`, `|10⟩`, `|11⟩`). Lane labels
  use the shared display bit-order convention (`shared/display/outcomes.ts`):
  the leftmost character is q0 (the top wire).
- **The runner is everywhere at once.** It renders as a ghost in every lane with
  **opacity = probability**. There is no circuit history — this is a *state*, not
  a circuit; the gate buttons mutate the live amplitudes directly.
- **Gate buttons** (a grid at the bottom): level 1 offers one row `X₀ H₀`;
  level 2 two rows of three, one per qubit, each ending in the CX that qubit
  controls — `X₀ H₀ CX 0→1` over `X₁ H₁ CX 1→0` (`GATE_BUTTONS` /
  `GATE_COLUMNS`). Each tap applies immediately. On a short landscape screen
  (≤ 450 px tall) the grid sits beside the field, bottom right.
- **Reset** (HUD, left of ❚❚): "Reset |0⟩" / "Reset |00⟩" (German "Zurück auf
  |0⟩" / "Zurück auf |00⟩"; VoiceOver "Reset all qubits to 0") puts every qubit
  back to `|0⟩` — the engine's `reset` event, `resetAmplitudes`. It is a real
  operation but **not a gate**: non-unitary, it moves all the probability onto
  `|0…0⟩` (renormalised) and forgets the state, so no gate sequence undoes it.
  **Balance:** free — no score or life cost — and it changes nothing else:
  columns, lives, score and timing are untouched, and the next obstacle
  measures the reset state like any other (reset into an obstacle on `|00⟩` is
  a certain hit). The live region says "Reset. |00⟩ 100%." at once (not throttled). The How to play
  rules carry one line on it.
- **Coins** scroll in and, when a coin column crosses the runner line, add the
  **expected value** `Σ P(coin lane)` to the score (shown as `+0.7`-style
  floats; the running score is fractional, one decimal). Coins are deliberately
  **unmeasured** — a clean superposition banks partial credit.
- **Obstacles are the measurement.** When a red obstacle column reaches the
  runner it triggers a **projective measurement** of the projector onto the
  obstacle lanes. With probability `p = Σ P(obstacle lane)` you are **HIT** (lose
  a life, the state collapses *into* the obstacle lanes, renormalized);
  otherwise you **SURVIVE** (the state collapses *away*, onto the complement).
  Both outcomes snap the ghosts. Edge cases fall out for free: `p = 0` is a clean
  pass (no drama); `p = 1` is a certain hit.
- **The level-2 aha-moment.** The obstacle pool includes the **anti-correlated
  pair** on `|01⟩` and `|10⟩`. The Φ⁺ Bell state — reachable with `H₀` then
  `CX0→1` → `(|00⟩+|11⟩)/√2` — has *zero* probability on those lanes, so a Bell
  runner is **perfectly safe**. Building entanglement to become immune to a
  measurement is the lesson.
- **Lives + pacing.** Three lives; the run ends at zero with a game-over screen
  (score + distance + "measurement got you" flavour + restart). Speed and
  spawn rate ramp per level (`LEVEL_RUNNER_CONFIG` in the engine):

  | | Level 1 (unchanged) | Level 2 |
  | --- | --- | --- |
  | Start speed (field-widths/s; time a column needs to cross) | 0.20 (5.0 s) | 0.14 (7.1 s) |
  | Speed ramp | +0.006 /s | +0.0034 /s |
  | Top speed (crossing) | 0.62 (1.6 s), after 70 s | 0.62 (1.6 s), after 141 s |
  | Column spacing at start → minimum | 1.9 s → 0.7 s, after 92 s | 2.1 s → 0.7 s, after 184 s |

  Level 2 starts slower and takes about twice as long to get fast (four lanes
  and six gates need more thinking). A level change picks up the new level's
  pacing. A simulated player (attends to the nearest obstacle, plans the
  shortest safe gate sequence after a fixed reaction time, taps a gate every
  0.35 s; 150 seeded runs) lasts at 2 qubits a median ~103 s / 50 obstacles
  with the level-1 pacing and ~193 s / 78 obstacles with the new one (0.9 s
  reaction); it only fails once the column spacing nears its minimum, so real
  players, who also misplan, end sooner.

- **Best score** per level is kept in `localStorage`
  (`entangible.pocket.runner.best`, `{"1": 12.3, "2": 4.5}`) and shown on the
  game-over card ("New best!" when beaten).

## Pause

The run holds whenever the page is hidden (`visibilitychange`), the window
loses focus (`blur`) or the page is put away (`pagehide`), on the ❚❚ button in
the HUD, and while the embedding shell says so (`suspended` — the runner
bundle's rules sheet). It never resumes on its own: **Resume** starts a 3-2-1
countdown (one number a second), then the run goes on. The gate buttons are
disabled while held.

## Accessibility

`prefers-reduced-motion` suppresses the slow-mo / flash effects — collapses snap
instantly and the game stays fully playable (the countdown numbers stay, without
their zoom).

VoiceOver: every gate button has a name ("Apply H to qubit 0", "Apply CX,
control qubit 0, target qubit 1"; German "H auf Qubit 0 anwenden" …). One
polite live region speaks each coin and obstacle — what happened, the lane
probabilities ("|00⟩ 50%, |11⟩ 50%", lanes at 0 % left out), lives and score —
at most one line every 2 s (the latest waiting line wins at the end of the
gap). Game over (with the best score), a new run, pause and the countdown are
spoken at once.

## Runner-only bundle

The same `RunnerGame` also ships alone, for the Fun with Quantum iOS app —
see [`runner-bundle.md`](runner-bundle.md). It takes its analytics as an
optional `onEvent` prop (the site passes `trackGame`, the bundle nothing), so
the component itself imports no analytics.

## Architecture

All game and quantum logic is a **pure, RNG-injectable reducer** in
`shared/quantum/runner.ts` (`(state, event, rng) → state`); the UI owns only
timing (a `requestAnimationFrame` tick loop) and rendering. The quantum math
reuses the booth engine's single source of gate definitions
(`singleQubitUnitary` from `shared/quantum/statevector.ts` for the H/X matrices)
and the seeded/crypto RNGs from `shared/menu/sample.ts` (`mulberry32` in tests,
`cryptoRng` live). Golden tests pin the collapse-both-ways behaviour, the Bell
safety, renormalization, and full seeded-playthrough determinism
(`shared/quantum/runner.test.ts`).

## Mode plumbing

`runner` is an additive display mode (`shared/ws/messages.ts` `DisplayMode`,
`docs/protocol.md`, the host's `VALID_MODES`/`MODE_PANELS` with an **empty**
panel preset). It is a **pocket-only** surface in v1: the booth kiosk has no
runner UI and falls back gracefully to its composer-style stage when an operator
selects it (verified by `pocket-app/src/kiosk/KioskView.runner.test.tsx`). Reach
it from **Settings → Mode → Quantum Runner** or the deep link
`entangible.org/?mode=runner`.
