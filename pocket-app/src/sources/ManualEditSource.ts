/**
 * ManualEditSource — an on-screen circuit-building input mode behind the
 * `StateSource` seam (Entangible One, docs/design.md "Entangible One").
 *
 * The no-camera / no-tiles fallback: instead of the vision pipeline or a booth
 * host, the circuit comes from the editor's OWN native editing. The pocket app
 * renders `@qamposer/react` in CONTROLLED mode (`QamposerProvider circuit=…`)
 * with `onCircuitChange` wired to {@link setFromEditor}; each on-screen edit
 * updates this source's held circuit, which emits a neutral {@link StateUpdate}
 * (empty warnings, `source:'manual'`) into the SAME `applyUpdate` every other
 * source feeds — so simulation, moments, golf, celebrations and the Transfer /
 * Composer handoff all "just work", identical to the camera path.
 *
 * FEEDBACK-LOOP GUARD: the held circuit is the controlled value flowed BACK
 * into the editor. `@qamposer/react` only fires `onCircuitChange` on real user
 * edits (never on a prop-driven re-render — verified against the library), but
 * we still dedupe structurally here so an echo can never re-emit and loop.
 *
 * FIVE-QUBIT TRUTH: the physical board is always five qubits, so a manual
 * circuit is pinned to the same fixed register (`config.maxQubits` caps the
 * editor at 5). The wire-display setting still collapses empty trailing wires
 * for the on-screen view via the shared `displayCircuit` transform in `App`;
 * downstream always sees the full register, exactly like the camera path.
 *
 * SOURCE PRECEDENCE (a connected booth viewer wins over manual): the pure
 * {@link resolveActiveInput} encodes it — `?connect=1` / a booth link makes the
 * app a read-only viewer regardless of `?input=manual`. `App` selects the
 * active source with it.
 */
import type { Circuit } from '@qamposer/react';
import type { StateListener, StateSource, StateUpdate } from './StateSource';

/** The physical board is always five qubits (matches the booth + pipeline). */
export const BOARD_QUBITS = 5;

/** Which input mode drives the app when it is NOT a connected booth viewer. */
export type InputMode = 'camera' | 'manual';

/** The resolved active source for `App`'s source-selection effect. */
export type ActiveInput = 'booth' | 'manual' | 'camera';

/**
 * Decide which state source is active. A connected booth viewer ALWAYS wins —
 * `?connect=1` (or a manual booth link) beats `?input=manual` (docs/design.md
 * "Entangible One" role precedence). Otherwise the persisted/URL input mode
 * chooses manual vs the local camera pipeline.
 */
export function resolveActiveInput(opts: {
  connected: boolean;
  input: InputMode;
}): ActiveInput {
  if (opts.connected) return 'booth';
  return opts.input === 'manual' ? 'manual' : 'camera';
}

/** An empty circuit for the given register size (no editor-bundle dependency). */
function emptyCircuit(qubits: number): Circuit {
  return { qubits, gates: [] } as Circuit;
}

/** Pin a circuit to the fixed register size, reusing the input when it matches. */
function pinQubits(circuit: Circuit, qubits: number): Circuit {
  return circuit.qubits === qubits ? circuit : { qubits, gates: circuit.gates };
}

/** Structural equality — the feedback-loop guard (mirrors the pipeline's check). */
function circuitsEqual(a: Circuit, b: Circuit): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

export interface ManualEditOptions {
  /** Fixed register size (default {@link BOARD_QUBITS}); the editor cap matches. */
  qubits?: number;
  /** Seed circuit (default empty). Pinned to `qubits`. */
  initial?: Circuit;
}

export class ManualEditSource implements StateSource {
  readonly kind = 'manual' as const;
  private readonly listeners = new Set<StateListener>();
  private readonly qubits: number;
  private circuit: Circuit;
  private started = false;

  constructor(options: ManualEditOptions = {}) {
    this.qubits = options.qubits ?? BOARD_QUBITS;
    this.circuit = pinQubits(options.initial ?? emptyCircuit(this.qubits), this.qubits);
  }

  /** Begin producing updates; pushes the current circuit so downstream syncs. */
  start(): void {
    if (this.started) return;
    this.started = true;
    this.emit();
  }

  /** Stop emitting; the held circuit is retained for a later re-entry. */
  stop(): void {
    this.started = false;
  }

  subscribe(listener: StateListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** The controlled circuit fed back to the editor (App reads this to seed it). */
  getCircuit(): Circuit {
    return this.circuit;
  }

  /**
   * Empty the board. The build-on-screen equivalent of lifting every cube off
   * the physical table — golf's "clear the board for the next level" needs an
   * on-screen affordance (the Scorecard's Next-level button calls this).
   */
  clear(): void {
    this.setFromEditor(emptyCircuit(this.qubits));
  }

  /**
   * Accept an edit from the editor's `onCircuitChange`. Pins the register to
   * the fixed size and emits a neutral update ONLY when the circuit actually
   * changed — the guard that keeps the controlled value flowing back into the
   * editor from re-emitting (no feedback loop).
   */
  setFromEditor(next: Circuit): void {
    const pinned = pinQubits(next, this.qubits);
    if (circuitsEqual(pinned, this.circuit)) return;
    this.circuit = pinned;
    if (this.started) this.emit();
  }

  private emit(): void {
    const update: StateUpdate = {
      source: 'manual',
      circuit: this.circuit,
      warnings: [],
    };
    for (const listener of this.listeners) listener(update);
  }
}
