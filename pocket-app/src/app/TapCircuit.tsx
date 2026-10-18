/**
 * Golf's tap grid — the circuit as cells you can tap (part of `TapPlay`).
 *
 * One row per qubit of the hole, one column per step plus always one free
 * column at the end; only the grid scrolls sideways when the circuit is long.
 * Every cell is a ≥ 44 px button with a full spoken name ("Qubit 1, step 3,
 * empty: place H", "CX control on qubit 0, step 2, target qubit 1"). With a
 * tool picked, empty cells show a faint +, and a 24 px strip over the edge
 * between two columns inserts a new column right there ("Insert H on qubit 0
 * before step 2" — a real button, so VoiceOver reaches it too).
 *
 * While a CX/CH waits for its target (`pending`), the control's ● sits in its
 * cell (tap it again to cancel) and the other qubits of that column light up
 * as targets; a control placed at a gap opens a provisional column there.
 *
 * `stepColumn` (holed in, #13): the column the evolution replay is at gets
 * `is-step` and `aria-current="step"` on its cells.
 *
 * Presentational: what a tap means is `TapPlay`'s business.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { Circuit, GateType } from '@qamposer/react';
import type { Messages } from '@shared/i18n';
import { clubLabel, gridModel, isTwoQubitClub, type Cell } from './tapPlacement';

/** A two-qubit gate's control, waiting for its target. */
export interface PendingControl {
  readonly type: GateType;
  readonly control: number;
  /** The column the gate will take (for `insert`: the new column's index). */
  readonly column: number;
  /** True when the control was put in a gap: a new column opens there. */
  readonly insert: boolean;
}

export interface TapCircuitProps {
  readonly circuit: Circuit;
  /** The hole's qubit count (rows; more if a gate already sits higher). */
  readonly qubits: number;
  readonly tool: GateType | null;
  readonly pending: PendingControl | null;
  readonly selectedId: string | null;
  readonly disabled: boolean;
  /** The circuit column the evolution replay is at (marked), or null. */
  readonly stepColumn?: number | null;
  /** A cell was tapped (`column` is the circuit's column; -1 = provisional). */
  readonly onCell: (qubit: number, column: number, cell: Cell) => void;
  /** The gap before `column` on `qubit` was tapped. */
  readonly onGap: (qubit: number, column: number) => void;
  readonly t: Messages;
}

const EMPTY: Cell = { kind: 'empty' };

export function TapCircuit({
  circuit,
  qubits,
  tool,
  pending,
  selectedId,
  disabled,
  stepColumn = null,
  onCell,
  onGap,
  t,
}: TapCircuitProps) {
  const m = t.tapPlay;
  const model = useMemo(() => gridModel(circuit, qubits), [circuit, qubits]);
  const toolLabel = tool ? clubLabel(tool) : '';
  const twoTool = tool !== null && isTwoQubitClub(tool);

  // Display columns: the model's, plus a provisional one while a control waits
  // in a gap. `logical[d]` is the circuit column of display column d (-1 for
  // the provisional one).
  const logical = useMemo(() => {
    const cols = Array.from({ length: model.columns }, (_, c) => c);
    if (pending?.insert) cols.splice(pending.column, 0, -1);
    return cols;
  }, [model.columns, pending]);
  const pendingDisplay = pending ? (pending.insert ? pending.column : logical.indexOf(pending.column)) : -1;
  // Gates sit in columns 0..used-1; a gap before any of them inserts.
  const used = circuit.gates.reduce((u, g) => Math.max(u, g.position + 1), 0);
  const showGaps = tool !== null && pending === null && !disabled;

  // Keep the cell that just changed in view when the grid scrolls sideways.
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || pendingDisplay < 0) return;
    const cell = el.querySelector<HTMLElement>(`[data-col="${pendingDisplay}"]`);
    cell?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [pendingDisplay]);
  // …and the column the replay is at.
  const stepDisplay = stepColumn === null ? -1 : logical.indexOf(stepColumn);
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || stepDisplay < 0) return;
    const cell = el.querySelector<HTMLElement>(`[data-col="${stepDisplay}"]`);
    cell?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
  }, [stepDisplay]);

  const cellName = (cell: Cell, q: number, d: number, col: number): string => {
    const step = d + 1;
    if (pending && d === pendingDisplay) {
      const gate = clubLabel(pending.type);
      if (q === pending.control) return m.pending(gate, q, step);
      return m.placeTarget(q, step, gate);
    }
    switch (cell.kind) {
      case 'empty':
        if (!tool || pending) return m.empty(q, step);
        return twoTool ? m.emptyControl(q, step, toolLabel) : m.emptyPlace(q, step, toolLabel);
      case 'single':
        return m.single(clubLabel(cell.gate.type), q, col + 1);
      case 'control':
        return m.control(clubLabel(cell.gate.type), q, col + 1, cell.gate.target!);
      case 'target':
        return m.target(clubLabel(cell.gate.type), q, col + 1, cell.gate.control!);
      case 'crossed':
        return m.crossed(q, col + 1, clubLabel(cell.gate.type));
    }
  };

  return (
    <div className="pk-tapgrid-scroll" ref={scrollRef}>
      <div
        className="pk-tapgrid"
        role="group"
        aria-label={m.gridAria(model.rows, model.columns)}
        style={{ ['--cols' as string]: logical.length }}
      >
        {Array.from({ length: model.rows }, (_, q) => (
          <div key={q} className="pk-tapgrid-row">
            <span className="pk-tapgrid-q" aria-hidden="true">
              q{q}
            </span>
            {logical.map((col, d) => {
              const cell = col < 0 ? EMPTY : model.cells[q][col];
              const inPending = pending !== null && d === pendingDisplay;
              const isControl = inPending && q === pending!.control;
              const isTargetOption = inPending && !isControl;
              const gate = cell.kind === 'empty' ? null : cell.gate;
              const selected = gate !== null && gate.id === selectedId;
              const atStep = stepColumn !== null && col === stepColumn;
              const placeable = !inPending && cell.kind === 'empty' && tool !== null && pending === null;
              // With a tool (or a control waiting), only cells that do
              // something are live; without one, gates are (to select them).
              const live = disabled
                ? false
                : pending
                  ? inPending
                  : tool
                    ? placeable
                    : gate !== null;
              const span =
                gate && gate.control !== undefined && gate.target !== undefined
                  ? cell.kind === 'crossed'
                    ? ' v-full'
                    : (cell.kind === 'control') === gate.control < gate.target
                      ? ' v-down'
                      : ' v-up'
                  : '';
              const classes = [
                'pk-tapgrid-cell',
                `is-${cell.kind}`,
                span,
                placeable ? 'is-placeable' : '',
                isControl ? 'is-pending' : '',
                isTargetOption ? 'is-target-option' : '',
                selected ? 'is-selected' : '',
                atStep ? 'is-step' : '',
              ]
                .filter(Boolean)
                .join(' ');
              let name = cellName(cell, q, d, col);
              if (selected) name += m.selected;
              return (
                <button
                  key={d}
                  type="button"
                  className={classes}
                  data-q={q}
                  data-col={d}
                  aria-label={name}
                  aria-pressed={!tool && gate !== null ? selected : undefined}
                  aria-disabled={live ? undefined : true}
                  aria-current={atStep ? 'step' : undefined}
                  onClick={() => {
                    if (live) onCell(q, col, cell);
                  }}
                >
                  <span className="pk-tapgrid-mark" aria-hidden="true">
                    {isControl
                      ? '●'
                      : cell.kind === 'single'
                        ? clubLabel(cell.gate.type)
                        : cell.kind === 'control'
                          ? '●'
                          : cell.kind === 'target'
                            ? cell.gate.type === 'CNOT'
                              ? '⊕'
                              : clubLabel(cell.gate.type).slice(1)
                            : placeable || isTargetOption
                              ? '+'
                              : ''}
                  </span>
                </button>
              );
            })}
            {showGaps &&
              Array.from({ length: used }, (_, k) => (
                <button
                  key={`gap${k}`}
                  type="button"
                  className="pk-tapgrid-gap"
                  style={{ ['--gap' as string]: k }}
                  aria-label={
                    twoTool ? m.insertControl(toolLabel, q, k + 1) : m.insert(toolLabel, q, k + 1)
                  }
                  onClick={() => onGap(q, k)}
                />
              ))}
          </div>
        ))}
      </div>
    </div>
  );
}

export default TapCircuit;
