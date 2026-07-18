/**
 * Build a `@qamposer/react` Circuit from per-cell tile placements.
 * EXACT port of `circuit_builder.py` — same deterministic gate ids
 * (`type-qubit-position` / `cnot-control-position`, lowercase), same CNOT
 * pairing (globally nearest control/target by row), same structured warnings
 * (`cell_conflict` / `lone_control` / `lone_target`), same ordering. The golden
 * fixtures in `tests/fixtures/circuits/*.json` pass through byte-identically.
 */
import { MARKER_TABLE, type GateSpec } from './markers';

const CNOT_CONTROL_ID = 14;
const CNOT_TARGET_ID = 15;

export interface TilePlacement {
  readonly markerId: number;
  readonly row: number;
  readonly col: number;
}

// 'off_grid' is emitted by the pipeline (not the builder) but shares the shape.
export type WarningKind = 'cell_conflict' | 'lone_control' | 'lone_target' | 'off_grid';

export interface BuildWarning {
  readonly kind: WarningKind;
  readonly message: string;
  readonly row: number | null;
  readonly col: number | null;
  readonly marker_ids: number[];
}

export interface CircuitGate {
  id: string;
  type: string;
  qubit?: number;
  control?: number;
  target?: number;
  position: number;
  parameter?: number;
}

export interface BuiltCircuit {
  qubits: number;
  gates: CircuitGate[];
}

export interface BuildResult {
  circuit: BuiltCircuit;
  warnings: BuildWarning[];
}

function specFor(markerId: number): GateSpec {
  const spec = MARKER_TABLE.get(markerId);
  if (!spec) throw new Error(`no marker table entry for id ${markerId}`);
  return spec;
}

function singleQubitGate(spec: GateSpec, row: number, col: number): CircuitGate {
  // Tiles without a native @qamposer/react type (S / T) are emitted as their
  // RZ equivalent via `emitAs` — so the circuit JSON only ever carries RZ.
  if (spec.emitAs) {
    const [emitType, emitParameter] = spec.emitAs;
    return {
      id: `${emitType.toLowerCase()}-${row}-${col}`,
      type: emitType,
      qubit: row,
      position: col,
      parameter: emitParameter,
    };
  }

  const gate: CircuitGate = {
    id: `${spec.gate.toLowerCase()}-${row}-${col}`,
    type: spec.gate,
    qubit: row,
    position: col,
  };
  if (spec.parameter !== undefined) gate.parameter = spec.parameter;
  return gate;
}

function cnotGate(controlRow: number, targetRow: number, col: number): CircuitGate {
  return {
    id: `cnot-${controlRow}-${col}`,
    type: 'CNOT',
    control: controlRow,
    target: targetRow,
    position: col,
  };
}

/** Pair controls with targets in one column, nearest-by-row first. */
function pairCnots(
  controlRows: number[],
  targetRows: number[],
  col: number,
): { pairs: Array<[number, number]>; warnings: BuildWarning[] } {
  const remainingC = [...controlRows].sort((a, b) => a - b);
  const remainingT = [...targetRows].sort((a, b) => a - b);
  const pairs: Array<[number, number]> = [];

  while (remainingC.length > 0 && remainingT.length > 0) {
    let best: [number, number, number] | null = null; // (dist, c, t)
    for (const c of remainingC) {
      for (const t of remainingT) {
        const dist = Math.abs(c - t);
        const key: [number, number, number] = [dist, c, t];
        if (best === null || lessThan3(key, best)) best = key;
      }
    }
    // best is non-null here (loops ran at least once).
    const [, cRow, tRow] = best as [number, number, number];
    pairs.push([cRow, tRow]);
    remainingC.splice(remainingC.indexOf(cRow), 1);
    remainingT.splice(remainingT.indexOf(tRow), 1);
  }

  const warnings: BuildWarning[] = [];
  for (const c of remainingC) {
    warnings.push({
      kind: 'lone_control',
      message: `CNOT control at row ${c}, column ${col} has no target in its column; excluded.`,
      row: c,
      col,
      marker_ids: [CNOT_CONTROL_ID],
    });
  }
  for (const t of remainingT) {
    warnings.push({
      kind: 'lone_target',
      message: `CNOT target at row ${t}, column ${col} has no control in its column; excluded.`,
      row: t,
      col,
      marker_ids: [CNOT_TARGET_ID],
    });
  }
  return { pairs, warnings };
}

/** Lexicographic `<` for 3-tuples (mirrors Python tuple comparison). */
function lessThan3(a: [number, number, number], b: [number, number, number]): boolean {
  if (a[0] !== b[0]) return a[0] < b[0];
  if (a[1] !== b[1]) return a[1] < b[1];
  return a[2] < b[2];
}

export function buildCircuit(placements: TilePlacement[], qubits: number): BuildResult {
  const warnings: BuildWarning[] = [];

  // 1. Resolve cell conflicts: at most one tile per (row, col).
  const byCell = new Map<string, TilePlacement[]>();
  for (const p of placements) {
    const key = `${p.row},${p.col}`;
    const list = byCell.get(key);
    if (list) list.push(p);
    else byCell.set(key, [p]);
  }

  const kept: TilePlacement[] = [];
  for (const cellTiles of byCell.values()) {
    if (cellTiles.length > 1) {
      const { row, col } = cellTiles[0];
      warnings.push({
        kind: 'cell_conflict',
        message: `${cellTiles.length} tiles occupy cell (row ${row}, column ${col}); all excluded.`,
        row,
        col,
        marker_ids: [...cellTiles.map((t) => t.markerId)].sort((a, b) => a - b),
      });
      continue;
    }
    kept.push(cellTiles[0]);
  }

  // 2. Split kept tiles into single-qubit gates and CNOT halves per column.
  const gates: CircuitGate[] = [];
  const controlsByCol = new Map<number, number[]>();
  const targetsByCol = new Map<number, number[]>();

  for (const p of kept) {
    const spec = specFor(p.markerId);
    if (spec.gate === 'CNOT') {
      const map = spec.role === 'control' ? controlsByCol : targetsByCol;
      const list = map.get(p.col);
      if (list) list.push(p.row);
      else map.set(p.col, [p.row]);
    } else {
      gates.push(singleQubitGate(spec, p.row, p.col));
    }
  }

  // 3. Pair CNOT halves per column.
  const cols = [...new Set([...controlsByCol.keys(), ...targetsByCol.keys()])].sort(
    (a, b) => a - b,
  );
  for (const col of cols) {
    const { pairs, warnings: colWarnings } = pairCnots(
      controlsByCol.get(col) ?? [],
      targetsByCol.get(col) ?? [],
      col,
    );
    warnings.push(...colWarnings);
    for (const [controlRow, targetRow] of pairs) {
      gates.push(cnotGate(controlRow, targetRow, col));
    }
  }

  // 4. Deterministic gate ordering: by column, then by primary row, then type.
  gates.sort((a, b) => {
    const ra = a.qubit ?? a.control ?? 0;
    const rb = b.qubit ?? b.control ?? 0;
    if (a.position !== b.position) return a.position - b.position;
    if (ra !== rb) return ra - rb;
    return a.type < b.type ? -1 : a.type > b.type ? 1 : 0;
  });

  // Deterministic warning ordering.
  warnings.sort((a, b) => {
    const ca = a.col ?? 0;
    const cb = b.col ?? 0;
    if (ca !== cb) return ca - cb;
    const rowA = a.row ?? 0;
    const rowB = b.row ?? 0;
    if (rowA !== rowB) return rowA - rowB;
    return a.kind < b.kind ? -1 : a.kind > b.kind ? 1 : 0;
  });

  return { circuit: { qubits, gates }, warnings };
}
