/**
 * The booth "moment engine" — pure classification of a stable circuit change
 * into a strip message and/or a celebration, per `docs/booth-ux.md` (Moments).
 *
 * It is a pure function of (prevCircuit, nextCircuit, state, now):
 *   - `state` carries the once-per-build-session achievement flags and the
 *     global celebration cooldown timestamp,
 *   - `now` is injected (ms epoch) so the 10 s cooldown is deterministic in
 *     tests.
 *
 * It must only ever be called on a *live* seq advance — never on a reconnect
 * replay of the latest circuit. The socket already dedupes by `seq`, so a
 * replay never reaches this engine; calling it twice with an identical circuit
 * is also safe (the achievement flags suppress a repeat celebration).
 */
import type { Circuit, Gate } from '@qamposer/react';
import {
  activeQubits,
  bellState,
  fidelity,
  ghzState,
  probOne,
  statevector,
} from './statevector';

/** Minimum state fidelity to accept a canonical (Bell / GHZ) match. */
export const FIDELITY_THRESHOLD = 0.99;
/** Global cooldown between any two celebrations. */
export const CELEBRATION_COOLDOWN_MS = 10_000;

export type CelebrationKind = 'bell' | 'ghz';

export interface Celebration {
  readonly kind: CelebrationKind;
  /** Number of entangled qubits (2 for Bell, k ≥ 3 for GHZ-k). */
  readonly k: number;
}

/**
 * Achievement / anti-spam state. Everything except the cooldown timestamp is
 * reset when the board is cleared ("re-arm only after the board is emptied").
 */
export interface MomentState {
  readonly firstGateSeen: boolean;
  readonly bellCelebrated: boolean;
  readonly ghzCelebrated: boolean;
  readonly uniformShown: boolean;
  /** Epoch ms of the last celebration, or null if none yet. */
  readonly lastCelebrationAt: number | null;
}

export const initialMomentState: MomentState = {
  firstGateSeen: false,
  bellCelebrated: false,
  ghzCelebrated: false,
  uniformShown: false,
  lastCelebrationAt: null,
};

export interface MomentResult {
  readonly stripMessage?: string;
  readonly celebration?: Celebration;
  readonly state: MomentState;
}

const label = (q: number): string => `q${q}`;

/** Stable identity of a gate for prev→next diffing. */
function gateKey(g: Gate): string {
  return `${g.type}:${g.position}:${g.qubit ?? ''}:${g.control ?? ''}:${g.target ?? ''}`;
}

/** Gates present in `next` but not in `prev`. */
function addedGates(prev: Circuit, next: Circuit): Gate[] {
  const prevKeys = new Set(prev.gates.map(gateKey));
  return next.gates.filter((g) => !prevKeys.has(gateKey(g)));
}

/** True when every one of the five rows carries at least one H gate. */
function everyRowHasH(circuit: Circuit): boolean {
  const withH = new Set<number>();
  for (const g of circuit.gates) if (g.type === 'H' && g.qubit != null) withH.add(g.qubit);
  return [0, 1, 2, 3, 4].every((q) => withH.has(q));
}

/**
 * Classify a stable circuit change. Returns the next `state` always, plus an
 * optional strip message and/or celebration.
 *
 * Precedence (highest first):
 *   1. Board cleared after activity → reset achievements.
 *   2. GHZ-k celebration (k ≥ 3).
 *   3. Bell celebration (exactly 2 active qubits).
 *   4. First gate ever this build session.
 *   5. Uniform superposition (all five rows carry an H).
 *   6. Superposition (an H was just placed, that qubit is now 50/50).
 *   7. Bit flip (an X was just placed, that qubit is now |1⟩).
 */
export function evaluateMoment(
  prev: Circuit,
  next: Circuit,
  state: MomentState,
  now: number,
): MomentResult {
  const prevCount = prev.gates.length;
  const nextCount = next.gates.length;

  // 1. Board cleared after activity → reset (keep the global cooldown clock).
  if (nextCount === 0) {
    if (prevCount > 0) {
      return {
        stripMessage: 'Ready for the next quantum architect',
        state: { ...initialMomentState, lastCelebrationAt: state.lastCelebrationAt },
      };
    }
    return { state };
  }

  const sv = statevector(next);
  const active = activeQubits(next);
  const k = active.length;
  const cooldownReady =
    state.lastCelebrationAt === null || now - state.lastCelebrationAt >= CELEBRATION_COOLDOWN_MS;

  // 2. GHZ-k (k ≥ 3).
  if (k >= 3 && fidelity(sv, ghzState(active)) >= FIDELITY_THRESHOLD) {
    if (!state.ghzCelebrated && cooldownReady) {
      return {
        celebration: { kind: 'ghz', k },
        state: { ...state, ghzCelebrated: true, lastCelebrationAt: now },
      };
    }
    return { state };
  }

  // 3. Bell pair (exactly 2 active qubits).
  if (k === 2 && fidelity(sv, bellState(active)) >= FIDELITY_THRESHOLD) {
    if (!state.bellCelebrated && cooldownReady) {
      return {
        celebration: { kind: 'bell', k: 2 },
        stripMessage:
          'These qubits now answer together — measure one, know the other',
        state: { ...state, bellCelebrated: true, lastCelebrationAt: now },
      };
    }
    return { state };
  }

  // 4. First gate ever this build session.
  if (!state.firstGateSeen && prevCount === 0) {
    const g = next.gates[0];
    const q = g?.qubit ?? g?.control ?? 0;
    return {
      stripMessage: `${label(q)} is alive!`,
      state: { ...state, firstGateSeen: true },
    };
  }

  // 5. Uniform superposition — every row carries an H.
  if (k === 5 && everyRowHasH(next)) {
    if (!state.uniformShown) {
      return { stripMessage: '32 possibilities at once', state: { ...state, uniformShown: true } };
    }
    return { state };
  }

  const added = addedGates(prev, next);

  // 6. Superposition — an H was just placed and that qubit is now 50/50.
  const addedH = added.find((g) => g.type === 'H' && g.qubit != null);
  if (addedH && addedH.qubit != null && Math.abs(probOne(sv, addedH.qubit) - 0.5) < 0.01) {
    return {
      stripMessage: `Superposition — ${label(addedH.qubit)} is 0 and 1`,
      state,
    };
  }

  // 7. Bit flip — an X was just placed and that qubit is now |1⟩.
  const addedX = added.find((g) => g.type === 'X' && g.qubit != null);
  if (addedX && addedX.qubit != null && probOne(sv, addedX.qubit) > 0.99) {
    return {
      stripMessage: `Bit flip — ${label(addedX.qubit)} is now 1`,
      state,
    };
  }

  return { state };
}
