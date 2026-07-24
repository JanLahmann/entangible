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
- **Gate buttons** (a thumb row at the bottom): level 1 offers `X₀ H₀`; level 2
  adds the second qubit and both CX directions — `X₀ X₁ H₀ H₁ CX0→1 CX1→0`. Each
  tap applies immediately.
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
  (score + distance + "measurement got you" flavour + restart). Speed ramps so a
  typical run lasts ~45–90 s.

## Accessibility

`prefers-reduced-motion` suppresses the slow-mo / flash effects — collapses snap
instantly and the game stays fully playable.

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
