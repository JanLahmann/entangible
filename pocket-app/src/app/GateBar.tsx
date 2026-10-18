/**
 * Golf's gate bar — tap to play (docs/pocket.md "Gate bar").
 *
 * On a phone the drag palette and the circuit sit a screen apart from the
 * sphere, the library's tap-to-arm does not place gates in the iOS web view,
 * and the palette tiles are not accessible elements — so VoiceOver could not
 * play at all. The bar sits directly under the sphere and is made of real
 * buttons:
 *
 *   - the hole's clubs (exactly the palette's set) — a tap appends that gate
 *     at the end of the chosen wire(s);
 *   - a qubit picker (radiogroup, limited to the hole's qubits) and, when the
 *     round has a two-qubit club, a target picker (control ≠ target);
 *   - Undo (takes back the last gate) and Clear (the scorecard's wipe: one
 *     flat stroke);
 *   - a one-line score (par · strokes · fidelity) so the sphere, the bar and
 *     the score fit one phone screen;
 *   - an aria-live line that says what a tap did and where the hole stands.
 *
 * It never scores anything itself: every tap produces the next circuit and
 * hands it to `onChange` — the shells pass the very handler the on-screen
 * editor's `onCircuitChange` feeds (`ManualEditSource.setFromEditor`), so the
 * engine charges a tap exactly like the equivalent drag or delete.
 */
import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import type { Circuit, Gate } from '@qamposer/react';
import { useT, type Messages } from '@shared/i18n';
import { evaluate, holeScore, scoreName } from '@quantum/golf';
import type { GolfGame } from './useGolfGame';
import {
  appendGate,
  barClubs,
  clubLabel,
  gateWires,
  removeGate,
  undoTarget,
  type BarClub,
  type Wires,
} from './tapPlacement';

export interface GateBarProps {
  readonly game: GolfGame;
  /** The live board (the same circuit the sphere and scorecard read). */
  readonly circuit: Circuit;
  /** Where an edit goes — the on-screen editor's own change handler. */
  readonly onChange: (next: Circuit) => void;
}

/** Fidelity as the scorecard prints it. */
function percent(fidelity: number): string {
  return `${(fidelity * 100).toFixed(fidelity >= 0.999 ? 0 : 1)}%`;
}

function describeGate(gate: Gate, t: Messages, removed: boolean): string {
  const g = t.gateBar;
  const label = clubLabel(gate.type);
  const w = gateWires(gate);
  if ('qubit' in w) return removed ? g.removedOne(label, w.qubit) : g.addedOne(label, w.qubit);
  return removed
    ? g.removedTwo(label, w.control, w.target)
    : g.addedTwo(label, w.control, w.target);
}

export function GateBar({ game, circuit, onChange }: GateBarProps) {
  const t = useT();
  const g = t.gateBar;
  const { state, currentLevel: hole, dealing, wipeBoard } = game;
  const n = hole.qubits;
  const clubs = useMemo(() => barClubs(hole), [hole]);
  const hasTwo = n >= 2 && clubs.some((c) => c.twoQubit);

  // The picks survive a hole change; out-of-range ones are clamped at render.
  const [pickQ, setPickQ] = useState(0);
  const [pickT, setPickT] = useState(1);
  const qubit = Math.min(pickQ, n - 1);
  const target = pickT < n && pickT !== qubit ? pickT : (qubit + 1) % n;

  // Ids of the gates this bar placed, oldest first (Undo's history).
  const placedRef = useRef<string[]>([]);

  // aria-live: what the last tap did, then where the hole stands — written
  // once the engine has scored the change (the next render).
  const [spoken, setSpoken] = useState('');
  const pendingRef = useRef<{ what: string; before: Circuit } | null>(null);
  useEffect(() => {
    const pending = pendingRef.current;
    if (!pending || pending.before === circuit) return;
    pendingRef.current = null;
    const fidelity = evaluate(circuit, hole).fidelity;
    const status = state.holedIn
      ? g.holed(scoreName(holeScore(state.strokes, hole.par, !!state.revealed[hole.hole]), hole.par, t))
      : g.status(state.strokes, hole.par, percent(fidelity));
    setSpoken(`${pending.what} ${status}`);
  }, [circuit, state, hole, g, t]);

  const busy = dealing !== null;
  const edit = (next: Circuit, what: string) => {
    pendingRef.current = { what, before: circuit };
    onChange(next);
  };

  const place = (club: BarClub) => {
    const wires: Wires = club.twoQubit ? { control: qubit, target } : { qubit };
    const next = appendGate(circuit, club.type, wires);
    const added = next.gates.find((x) => !circuit.gates.some((y) => y.id === x.id));
    if (added) placedRef.current.push(added.id);
    edit(next, added ? describeGate(added, t, false) : '');
  };

  const undo = () => {
    const gate = undoTarget(circuit, placedRef.current);
    if (!gate) return;
    placedRef.current = placedRef.current.filter((id) => id !== gate.id);
    edit(removeGate(circuit, gate.id), describeGate(gate, t, true));
  };

  const canClear = !!wipeBoard && !state.holedIn && !state.complete && circuit.gates.length > 0;
  const clear = () => {
    if (!wipeBoard || !canClear) return;
    placedRef.current = [];
    pendingRef.current = { what: g.cleared, before: circuit };
    wipeBoard();
  };

  const ev = evaluate(circuit, hole);

  return (
    <div className="pk-gatebar" role="group" aria-label={g.aria}>
      <div className="pk-gatebar-clubs" role="group" aria-label={g.clubsAria}>
        {clubs.map((club) => {
          const blocked = club.twoQubit && n < 2;
          const label = blocked
            ? g.needsTwo(club.label)
            : club.twoQubit
              ? g.addTwo(club.label, qubit, target)
              : g.addOne(club.label, qubit);
          return (
            <button
              key={club.type}
              type="button"
              className={`pk-gatebar-club${club.twoQubit ? ' is-two' : ''}`}
              data-gate={club.type}
              aria-label={label}
              disabled={busy || blocked}
              onClick={() => place(club)}
            >
              <span className="pk-gatebar-sym" aria-hidden="true">
                {club.label}
              </span>
              <span className="pk-gatebar-where" aria-hidden="true">
                {blocked ? '—' : club.twoQubit ? `q${qubit}→q${target}` : `q${qubit}`}
              </span>
            </button>
          );
        })}
      </div>

      {n >= 2 && (
        <div className="pk-gatebar-picks">
          <QubitPicker
            symbol={hasTwo ? '●' : 'q'}
            label={hasTwo ? g.control : g.qubit}
            aria={hasTwo ? g.controlAria : g.qubitAria}
            n={n}
            value={qubit}
            onPick={(q) => {
              // Picking the target as control swaps the two.
              if (q === target) setPickT(qubit);
              setPickQ(q);
            }}
            t={t}
          />
          {hasTwo && (
            <QubitPicker
              symbol="⊕"
              label={g.target}
              aria={g.targetAria}
              n={n}
              value={target}
              exclude={qubit}
              onPick={setPickT}
              t={t}
            />
          )}
        </div>
      )}

      <div className="pk-gatebar-foot">
        <button
          type="button"
          className="pk-gatebar-act pk-gatebar-act--icon"
          aria-label={g.undoAria}
          title={g.undo}
          disabled={busy || circuit.gates.length === 0}
          onClick={undo}
        >
          <span aria-hidden="true">↶</span>
        </button>
        <button
          type="button"
          className="pk-gatebar-act"
          aria-label={g.clearAria}
          disabled={busy || !canClear}
          onClick={clear}
        >
          {g.clear} <span className="pk-gatebar-cost">+1</span>
        </button>
        <p className="pk-gatebar-score">
          <span>
            {t.scorecard.par} <b>{hole.par}</b>
          </span>
          <span>
            {t.scorecard.strokes} <b>{state.strokes}</b>
          </span>
          <span>
            {t.scorecard.fidelity}{' '}
            <b className={state.holedIn ? 'is-holed' : undefined}>{percent(ev.fidelity)}</b>
          </span>
        </p>
      </div>

      <p className="pk-sr-only" role="status" aria-live="polite">
        {spoken}
      </p>
    </div>
  );
}

/** A row of qubit radios (WAI-ARIA radio group: arrows move, one tab stop). */
function QubitPicker({
  symbol,
  label,
  aria,
  n,
  value,
  exclude,
  onPick,
  t,
}: {
  /** The circuit's own mark for the role (● control, ⊕ target). */
  symbol: string;
  /** The role in words (tooltip; the radiogroup carries the full name). */
  label: string;
  aria: string;
  n: number;
  value: number;
  exclude?: number;
  onPick: (q: number) => void;
  t: Messages;
}) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const qubits = Array.from({ length: n }, (_, q) => q);
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const step = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0;
    if (step === 0) return;
    e.preventDefault();
    let q = value;
    for (let i = 0; i < n; i++) {
      q = (q + step + n) % n;
      if (q !== exclude) break;
    }
    onPick(q);
    refs.current[q]?.focus();
  };
  return (
    <div className="pk-gatebar-pick">
      <span className="pk-gatebar-pick-label" aria-hidden="true" title={label}>
        {symbol}
      </span>
      <div role="radiogroup" aria-label={aria} className="pk-gatebar-radios" onKeyDown={onKey}>
        {qubits.map((q) => {
          const off = q === exclude;
          return (
            <button
              key={q}
              ref={(el) => {
                refs.current[q] = el;
              }}
              type="button"
              role="radio"
              aria-checked={q === value}
              aria-disabled={off || undefined}
              aria-label={t.gateBar.qubitName(q)}
              tabIndex={q === value ? 0 : -1}
              className={`pk-gatebar-q${q === value ? ' is-on' : ''}`}
              onClick={() => {
                if (!off) onPick(q);
              }}
            >
              q{q}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default GateBar;
