/**
 * MiniCircuit — a tiny, read-only circuit DRAWING (#71).
 *
 * Built for the golf scorecard's "Show solution" reveal, where a gate sequence
 * written out as text ("X q1 · CX q0→q1 · X q0") is genuinely hard to read: a
 * circuit is a picture, and people parse the picture. This draws that picture at
 * scorecard scale — one wire per qubit, one column per occupied position, gates
 * as rounded boxes, controls as dots on a vertical link.
 *
 * ## Conventions
 * Deliberately the SAME visual language as the `@qamposer/react` editor (and the
 * printed tiles, whose colours `assets.toml` pins to the editor's `GATE_COLORS`),
 * so a solution looks like the thing the player would build:
 *
 *  - colour by gate FAMILY — H red, X/CX/CCX dark blue, Y magenta, Z/S/T cyan;
 *  - a controlled gate is a filled dot per control, a vertical link, and either
 *    a ⊕ target (CX/CCX) or a lettered box (CZ/CH/CS/CT) — exactly the editor's
 *    `CONTROLLED_TARGET_LABELS` split;
 *  - a rotation carries its angle under its letter, inside a slightly wider box.
 *
 * The hexes are copied rather than imported because the library does not export
 * `GATE_COLORS`; `assets.toml [colors]` is the project's declared source of truth
 * for the same values, and the hardware kit is generated from it.
 *
 * ## Read-only, and physically inert
 * Pure props ({circuit, n, classPrefix}) — no state, no callbacks, nothing
 * writable. `pointer-events: none` is set INLINE rather than in the skins,
 * because it is a correctness property, not a look: tap-to-inspect and the
 * editor delegate off real DOM hits, and neither may ever see a gate that only
 * exists as an illustration. Showing a solution therefore cannot cost a stroke
 * (#68) or open a popover.
 *
 * Structural class names are `classPrefix`-scoped (`pk-`/`bo-`) and carry only
 * the skin-level look (wire/label colour, max-width); every geometry decision
 * lives here so both skins agree.
 */
import type { Circuit, Gate } from '@qamposer/react';
import { formatAngle } from '@quantum/inspectCopy';

/** Gate colours by family — the editor's `GATE_COLORS`, mirrored (see header). */
const GATE_COLOR: Readonly<Record<string, string>> = {
  H: '#fa4d56',
  X: '#002d9c',
  Y: '#9f1853',
  Z: '#33b1ff',
  S: '#33b1ff',
  T: '#33b1ff',
  RX: '#9f1853',
  RY: '#9f1853',
  RZ: '#33b1ff',
  CNOT: '#002d9c',
  CY: '#9f1853',
  CZ: '#33b1ff',
  CH: '#fa4d56',
  CS: '#33b1ff',
  CT: '#33b1ff',
  CCX: '#002d9c',
};
const FALLBACK_COLOR = '#525252';

/** Controlled gates drawn as a lettered box on the target wire; everything else
 *  controlled (CX, CCX) gets the ⊕ target. Mirrors the editor's split. */
const TARGET_LABEL: Readonly<Record<string, string>> = {
  CY: 'Y',
  CZ: 'Z',
  CH: 'H',
  CS: 'S',
  CT: 'T',
};

/** Rotations print their angle; they are also the only wider boxes. */
const ROTATIONS: ReadonlySet<string> = new Set(['RX', 'RY', 'RZ']);

// -- geometry (all in viewBox units; the SVG scales to the card) -------------
const ROW_PITCH = 26;
const COL_PITCH = 30;
/** Left gutter holding the q0… wire labels. */
const LABEL_W = 20;
/** Right margin so the last wire runs a little past its last gate. */
const RIGHT_PAD = 6;
const BOX = 20;
const ROT_BOX_W = 28;
const DOT_R = 3.2;
const TARGET_R = 7;

const rowY = (q: number) => q * ROW_PITCH + ROW_PITCH / 2;

/** The physical qubits a gate touches (single-qubit, controlled or Toffoli). */
function touched(gate: Gate): number[] {
  const qs: number[] = [];
  if (gate.qubit !== undefined) qs.push(gate.qubit);
  if (gate.control !== undefined) qs.push(gate.control);
  if (gate.control2 !== undefined) qs.push(gate.control2);
  if (gate.target !== undefined) qs.push(gate.target);
  return qs;
}

/** One drawn gate: a box on a wire, or a control-dot/link/target group. */
function MiniGate({ p, gate, x }: { p: string; gate: Gate; x: number }) {
  const color = GATE_COLOR[gate.type] ?? FALLBACK_COLOR;

  // Controlled: dots on the control wires, a link down to the target, and
  // either a ⊕ (CX/CCX) or a lettered box (CZ/CH/CS/CT).
  if (gate.control !== undefined && gate.target !== undefined) {
    const controls = gate.control2 === undefined ? [gate.control] : [gate.control, gate.control2];
    const rows = [...controls, gate.target];
    const top = rowY(Math.min(...rows));
    const bottom = rowY(Math.max(...rows));
    const label = TARGET_LABEL[gate.type];
    const ty = rowY(gate.target);
    return (
      <g>
        <line className={`${p}-mini-circ-link`} x1={x} y1={top} x2={x} y2={bottom} stroke={color} />
        {controls.map((c) => (
          <circle
            key={c}
            className={`${p}-mini-circ-dot`}
            cx={x}
            cy={rowY(c)}
            r={DOT_R}
            fill={color}
          />
        ))}
        {label ? (
          <GateBox p={p} x={x} y={ty} color={color} label={label} />
        ) : (
          <>
            <circle
              className={`${p}-mini-circ-target`}
              cx={x}
              cy={ty}
              r={TARGET_R}
              fill="none"
              stroke={color}
            />
            <path
              className={`${p}-mini-circ-cross`}
              d={`M${x - TARGET_R} ${ty}h${TARGET_R * 2}M${x} ${ty - TARGET_R}v${TARGET_R * 2}`}
              stroke={color}
            />
          </>
        )}
      </g>
    );
  }

  // Single-qubit: a lettered box, with the angle tucked under a rotation's name.
  const angle = ROTATIONS.has(gate.type) && gate.parameter !== undefined
    ? formatAngle(gate.parameter)
    : undefined;
  return (
    <GateBox
      p={p}
      x={x}
      y={rowY(gate.qubit ?? 0)}
      color={color}
      label={gate.type}
      angle={angle}
    />
  );
}

/** A rounded, filled gate box with its letter (and a rotation's angle beneath). */
function GateBox({
  p,
  x,
  y,
  color,
  label,
  angle,
}: {
  p: string;
  x: number;
  y: number;
  color: string;
  label: string;
  angle?: string;
}) {
  const w = angle ? ROT_BOX_W : BOX;
  return (
    <g>
      <rect
        className={`${p}-mini-circ-box`}
        x={x - w / 2}
        y={y - BOX / 2}
        width={w}
        height={BOX}
        rx={5}
        fill={color}
      />
      <text
        className={`${p}-mini-circ-gate`}
        x={x}
        y={angle ? y - 1 : y}
        textAnchor="middle"
        dominantBaseline="central"
      >
        {label}
      </text>
      {angle && (
        <text
          className={`${p}-mini-circ-angle`}
          x={x}
          y={y + 6.5}
          textAnchor="middle"
          dominantBaseline="central"
        >
          {angle}
        </text>
      )}
    </g>
  );
}

/**
 * Draw `circuit` on `n` wires. Columns are the circuit's OCCUPIED positions,
 * sorted and compacted, so a solution authored at positions 0/3/7 draws as three
 * adjacent columns and never as a sparse, mostly-empty strip.
 */
export function MiniCircuit({
  circuit,
  n,
  classPrefix,
}: {
  circuit: Circuit;
  /** Wires to draw — the hole's qubit count. Grown if a gate sits above it. */
  n: number;
  classPrefix: string;
}) {
  const p = classPrefix;
  const gates = circuit.gates;
  // Never clip a gate: a drawing that silently drops one is worse than a wide one.
  const highest = gates.reduce((m, g) => Math.max(m, ...touched(g)), -1);
  const rows = Math.max(1, n, highest + 1);

  // Occupied positions → compacted column indices.
  const columns = [...new Set(gates.map((g) => g.position))].sort((a, b) => a - b);
  const colOf = new Map(columns.map((pos, i) => [pos, i]));
  const colX = (pos: number) => LABEL_W + (colOf.get(pos) ?? 0) * COL_PITCH + COL_PITCH / 2;

  const width = LABEL_W + Math.max(1, columns.length) * COL_PITCH + RIGHT_PAD;
  const height = rows * ROW_PITCH;

  return (
    <svg
      className={`${p}-mini-circ`}
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="img"
      aria-label="solution circuit"
      // Correctness, not styling: these gates are an illustration, and neither
      // tap-to-inspect nor the editor may ever pick one up. See the header.
      style={{ pointerEvents: 'none' }}
    >
      {Array.from({ length: rows }, (_, q) => (
        <g key={q}>
          <line
            className={`${p}-mini-circ-wire`}
            x1={LABEL_W}
            y1={rowY(q)}
            x2={width}
            y2={rowY(q)}
          />
          <text
            className={`${p}-mini-circ-label`}
            x={LABEL_W - 5}
            y={rowY(q)}
            textAnchor="end"
            dominantBaseline="central"
          >
            q{q}
          </text>
        </g>
      ))}
      {gates.map((g) => (
        <MiniGate key={g.id} p={p} gate={g} x={colX(g.position)} />
      ))}
    </svg>
  );
}

export default MiniCircuit;
