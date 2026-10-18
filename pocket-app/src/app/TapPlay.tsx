/**
 * Golf, tap to play — under the sphere (docs/pocket.md "Tap to play").
 *
 * On a phone the library's drag palette and editor sit a screen away from the
 * sphere, its tap-to-arm places nothing in the iOS web view, and its tiles are
 * not accessible elements, so VoiceOver could not play. This is the touch and
 * screen-reader way to build a hole, made of real buttons:
 *
 *   - `GateBar`: the hole's clubs. Tap one to pick it as the tool (it stays
 *     picked; tap again to put it down).
 *   - `TapCircuit`: the circuit as a grid. With a tool, tap an empty cell to
 *     place it, or the edge between two columns to insert a new column there.
 *     CX/CH: tap the control cell (●), then a lit target cell (⊕); tap the ●
 *     again to cancel. Without a tool, tap a gate to select it: Delete
 *     removes it, a club replaces it.
 *   - Delete · ↶ Undo (the last grid change) · Clear +1 (the scorecard's
 *     wipe), and a one-line score.
 *   - A polite live region: what changed, then strokes / par / fidelity.
 *   - Holed in (#13): "Next hole" (or the course end's "Play again") takes the
 *     clubs' place in the flow — the sphere panel's scrubber and goal line stay
 *     uncovered and nothing moves. The board is then read-only (a change could
 *     only un-score or, emptied, advance the hole), and the grid marks the
 *     column the evolution replay is at (`GolfReplayContext`, aria-current).
 *
 * It never counts a stroke. Every change is the next `Circuit`, handed to
 * `onChange` — the shells pass the editor's own `onCircuitChange` handler
 * (`ManualEditSource.setFromEditor`) — so `useGolfGame.step` scores it like a
 * drag: an add 1, a delete 1, a replace 2 (the engine's key is the gate's type
 * and wiring), an undo whatever its board change is. The library editor shows
 * the same circuit state, so the two can never disagree.
 */
import { useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { Circuit, Gate, GateType } from '@qamposer/react';
import { useT, type Messages } from '@shared/i18n';
import { evaluate, holeScore, scoreName } from '@quantum/golf';
import type { GolfGame } from './useGolfGame';
import { GateBar } from './GateBar';
import { TapCircuit, type PendingControl } from './TapCircuit';
import { GolfReplayContext } from './golfReplay';
import {
  barClubs,
  canReplace,
  clubLabel,
  placeAt,
  removeGate,
  replaceGate,
  sameBoard,
  type BarClub,
  type Cell,
} from './tapPlacement';

export interface TapPlayProps {
  readonly game: GolfGame;
  /** The live board (the same circuit the sphere, scorecard and editor read). */
  readonly circuit: Circuit;
  /** Where an edit goes — the on-screen editor's own change handler. */
  readonly onChange: (next: Circuit) => void;
}

/** Fidelity as the scorecard prints it. */
function percent(fidelity: number): string {
  return `${(fidelity * 100).toFixed(fidelity >= 0.999 ? 0 : 1)}%`;
}

/** A placed gate in words ("H on qubit 0, step 1"). */
export function describeGate(gate: Gate, t: Messages): string {
  const label = clubLabel(gate.type);
  return gate.control !== undefined && gate.target !== undefined
    ? t.tapPlay.two(label, gate.control, gate.target, gate.position + 1)
    : t.tapPlay.single(label, gate.qubit ?? 0, gate.position + 1);
}

/** One grid change, for Undo. */
interface Change {
  readonly before: Circuit;
  readonly after: Circuit;
}

export function TapPlay({ game, circuit, onChange }: TapPlayProps) {
  const t = useT();
  const m = t.tapPlay;
  const { state, currentLevel: hole, dealing, wipeBoard, advanceHole } = game;
  const replay = useContext(GolfReplayContext);
  const clubs = useMemo(() => barClubs(hole), [hole]);

  const [tool, setTool] = useState<GateType | null>(null);
  const [pending, setPending] = useState<PendingControl | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [history, setHistory] = useState<readonly Change[]>([]);

  // A new hole tees off empty-handed (#12): Next hole, a jump, a course or
  // scope change and a restart put the tool down and drop a half-placed CX,
  // the selection and the undo history. Within a hole the tool stays picked.
  // A re-tee of the hole already in play (same index) shows as its strokes
  // going back down — they never fall while a hole is being played.
  const teeKey = `${state.course}:${state.randomSeed}:${String(state.scope)}:${state.levelIndex}:${state.complete}`;
  const [tee, setTee] = useState({ key: teeKey, strokes: state.strokes });
  if (tee.key !== teeKey || state.strokes < tee.strokes) {
    setTee({ key: teeKey, strokes: state.strokes });
    setTool(null);
    setPending(null);
    setSelectedId(null);
    setHistory([]);
  } else if (state.strokes !== tee.strokes) {
    setTee({ key: teeKey, strokes: state.strokes });
  }

  // A tool the new hole does not hand out is put down.
  const liveTool = tool !== null && clubs.some((c) => c.type === tool) ? tool : null;
  const selected = circuit.gates.find((g) => g.id === selectedId) ?? null;
  // Undo only while the board is still what our last change left (a drag in
  // the editor, a wipe or a new hole makes the history stale).
  const top = history[history.length - 1];
  const canUndo = top !== undefined && sameBoard(top.after, circuit);

  // A board change from anywhere ends a half-placed CX.
  useEffect(() => setPending(null), [circuit]);

  // aria-live: what the change did, then where the hole stands — written once
  // the engine has scored it (the render after the new circuit arrives).
  const [spoken, setSpoken] = useState('');
  const announceRef = useRef<{ what: string; before: Circuit } | null>(null);
  useEffect(() => {
    const a = announceRef.current;
    if (!a || a.before === circuit) return;
    announceRef.current = null;
    const status = state.holedIn
      ? m.holed(scoreName(holeScore(state.strokes, hole.par, !!state.revealed[hole.hole]), hole.par, t))
      : m.status(state.strokes, hole.par, percent(evaluate(circuit, hole).fidelity));
    setSpoken(`${a.what} ${status}`);
  }, [circuit, state, hole, m, t]);

  const busy = dealing !== null;
  // Holed in: the board is done — read-only, and the clubs give way to Next hole.
  const holed = state.holedIn;
  const locked = busy || holed;

  /** Hand a change to the engine's path and remember it for Undo. */
  const commit = (next: Circuit, what: string, record = true) => {
    if (sameBoard(next, circuit)) return;
    announceRef.current = { what, before: circuit };
    setHistory((h) => (record ? [...(canUndo ? h : []), { before: circuit, after: next }] : h));
    onChange(next);
  };

  const newId = () => `tap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

  const placed = (next: Circuit, id: string) => {
    const g = next.gates.find((x) => x.id === id);
    return g ? m.placed(describeGate(g, t)) : '';
  };

  const onClub = (club: BarClub) => {
    if (selected) {
      if (!canReplace(selected, club.type)) return;
      const id = newId();
      const next = replaceGate(circuit, selected.id, club.type, id);
      commit(next, m.replaced(describeGate(selected, t), club.label));
      setSelectedId(id);
      return;
    }
    setPending(null);
    setTool(liveTool === club.type ? null : club.type);
  };

  const onCell = (qubit: number, column: number, cell: Cell) => {
    if (pending) {
      if (qubit === pending.control) {
        setPending(null);
        setSpoken(m.cancelled);
        return;
      }
      const id = newId();
      const next = placeAt(
        circuit,
        pending.type,
        { control: pending.control, target: qubit },
        pending.column,
        id,
      );
      setPending(null);
      commit(next, placed(next, id));
      return;
    }
    if (liveTool) {
      if (cell.kind !== 'empty') return;
      if (clubs.find((c) => c.type === liveTool)?.twoQubit) {
        setPending({ type: liveTool, control: qubit, column, insert: false });
        setSpoken(m.chooseTarget(clubLabel(liveTool), qubit, column + 1));
        return;
      }
      const id = newId();
      const next = placeAt(circuit, liveTool, { qubit }, column, id);
      commit(next, placed(next, id));
      return;
    }
    if (cell.kind === 'empty') return;
    setSelectedId(cell.gate.id === selectedId ? null : cell.gate.id);
  };

  const onGap = (qubit: number, column: number) => {
    if (!liveTool) return;
    if (clubs.find((c) => c.type === liveTool)?.twoQubit) {
      setPending({ type: liveTool, control: qubit, column, insert: true });
      setSpoken(m.chooseTarget(clubLabel(liveTool), qubit, column + 1));
      return;
    }
    const id = newId();
    const next = placeAt(circuit, liveTool, { qubit }, column, id);
    commit(next, placed(next, id));
  };

  const onDelete = () => {
    if (!selected) return;
    setSelectedId(null);
    commit(removeGate(circuit, selected.id), m.removed(describeGate(selected, t)));
  };

  const onUndo = () => {
    if (!canUndo) return;
    setHistory((h) => h.slice(0, -1));
    setSelectedId(null);
    announceRef.current = { what: m.undone, before: circuit };
    onChange(top!.before);
  };

  const canClear = !!wipeBoard && !state.holedIn && !state.complete && circuit.gates.length > 0;
  const onClear = () => {
    if (!wipeBoard || !canClear) return;
    setHistory([]);
    setSelectedId(null);
    setPending(null);
    announceRef.current = { what: m.cleared, before: circuit };
    wipeBoard();
  };

  const fidelity = evaluate(circuit, hole).fidelity;

  return (
    <div className="pk-gatebar" role="group" aria-label={m.aria}>
      {holed && advanceHole ? (
        <button type="button" className="pk-golf-next pk-golf-next--bar" onClick={advanceHole}>
          {state.complete ? t.golf.playAgain : t.golf.nextHole}
        </button>
      ) : (
        <GateBar
          clubs={clubs}
          qubits={hole.qubits}
          tool={liveTool}
          selected={selected}
          disabled={locked}
          onClub={onClub}
          t={t}
        />
      )}
      <TapCircuit
        circuit={circuit}
        qubits={hole.qubits}
        tool={holed ? null : liveTool}
        pending={holed ? null : pending}
        selectedId={selected && !holed ? selected.id : null}
        disabled={locked}
        stepColumn={holed && replay ? replay.column : null}
        onCell={onCell}
        onGap={onGap}
        t={t}
      />
      <div className="pk-gatebar-foot">
        <button
          type="button"
          className="pk-gatebar-act"
          aria-label={m.deleteAria}
          disabled={locked || !selected}
          onClick={onDelete}
        >
          {m.deleteLabel}
        </button>
        <button
          type="button"
          className="pk-gatebar-act pk-gatebar-act--icon"
          aria-label={m.undoAria}
          title={m.undo}
          disabled={locked || !canUndo}
          onClick={onUndo}
        >
          <span aria-hidden="true">↶</span>
        </button>
        <button
          type="button"
          className="pk-gatebar-act"
          aria-label={m.clearAria}
          disabled={busy || !canClear}
          onClick={onClear}
        >
          {m.clear} <span className="pk-gatebar-cost">+1</span>
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
            <b className={state.holedIn ? 'is-holed' : undefined}>{percent(fidelity)}</b>
          </span>
        </p>
      </div>
      <p className="pk-sr-only" role="status" aria-live="polite">
        {spoken}
      </p>
    </div>
  );
}

export default TapPlay;
