/**
 * Q-sphere (2D flat projection) — a static SVG snapshot of the state, for golf
 * mode (docs/pocket.md). Concentric rings by Hamming weight (0–5); basis-state
 * nodes evenly spaced around each ring; node radius ∝ |amplitude| (a minimum
 * dot for zero); fill hue = phase; target-state nodes outlined in --entangle.
 *
 * Reads the same statevector as the RESULTS histogram. The layout is a pure
 * function (`qsphereLayout`) so the ring/node geometry is unit-testable.
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import { DIM, NUM_QUBITS, statevector, type StateVector } from '@quantum/statevector';

const AMP_EPS = 1e-6;
const START_ANGLE = -Math.PI / 2; // first node on each ring points up

export interface QNode {
  readonly index: number;
  readonly weight: number;
  readonly amp: number;
  readonly phaseDeg: number;
  readonly x: number;
  readonly y: number;
  readonly dot: number;
  readonly isTarget: boolean;
}

export interface QSphereLayoutOptions {
  readonly size: number;
  readonly margin?: number;
  readonly minDot?: number;
  readonly maxDot?: number;
  readonly targets?: ReadonlySet<number>;
}

function popcount(n: number): number {
  let c = 0;
  for (let x = n; x !== 0; x >>= 1) c += x & 1;
  return c;
}

/** Deterministic ring/node geometry for a statevector. */
export function qsphereLayout(sv: StateVector, opts: QSphereLayoutOptions): QNode[] {
  const { size, margin = 10, minDot = 1.5, maxDot = 9, targets } = opts;
  const cx = size / 2;
  const cy = size / 2;
  const maxR = size / 2 - margin;

  // Group basis indices by Hamming weight (ascending index within each ring).
  const rings: number[][] = Array.from({ length: NUM_QUBITS + 1 }, () => []);
  for (let i = 0; i < DIM; i++) rings[popcount(i)].push(i);

  const nodes: QNode[] = [];
  for (let w = 0; w <= NUM_QUBITS; w++) {
    const ring = rings[w];
    const radius = w === 0 ? 0 : (w / NUM_QUBITS) * maxR;
    const count = ring.length;
    for (let j = 0; j < count; j++) {
      const index = ring[j];
      const c = sv[index];
      const amp = Math.hypot(c.re, c.im);
      let phaseDeg = (Math.atan2(c.im, c.re) * 180) / Math.PI;
      if (phaseDeg < 0) phaseDeg += 360;
      const angle = count === 1 ? START_ANGLE : START_ANGLE + (j * 2 * Math.PI) / count;
      const x = w === 0 ? cx : cx + radius * Math.cos(angle);
      const y = w === 0 ? cy : cy + radius * Math.sin(angle);
      const dot = amp <= AMP_EPS ? minDot : minDot + (maxDot - minDot) * amp;
      nodes.push({
        index,
        weight: w,
        amp,
        phaseDeg,
        x,
        y,
        dot,
        isTarget: targets?.has(index) ?? false,
      });
    }
  }
  return nodes;
}

/** Radii of the concentric weight rings (for the guide circles). */
export function ringRadii(size: number, margin = 10): number[] {
  const maxR = size / 2 - margin;
  const radii: number[] = [];
  for (let w = 1; w <= NUM_QUBITS; w++) radii.push((w / NUM_QUBITS) * maxR);
  return radii;
}

export function QSphere2D({
  circuit,
  targets,
  size = 180,
}: {
  circuit: Circuit;
  targets?: ReadonlySet<number>;
  size?: number;
}) {
  const nodes = useMemo(
    () => qsphereLayout(statevector(circuit), { size, targets }),
    [circuit, targets, size],
  );
  const rings = useMemo(() => ringRadii(size), [size]);
  const cx = size / 2;
  const cy = size / 2;

  return (
    <div>
      <div className="pk-label">Q-sphere</div>
      <div className="pk-well pk-qsphere">
        <svg
          viewBox={`0 0 ${size} ${size}`}
          width="100%"
          className="pk-qsphere-svg"
          role="img"
          aria-label="Q-sphere state projection"
        >
          {rings.map((r, i) => (
            <circle key={i} cx={cx} cy={cy} r={r} className="pk-qs-ring" />
          ))}
          {nodes.map((n) => {
            const lit = n.amp > 0.02;
            return (
              <circle
                key={n.index}
                cx={n.x}
                cy={n.y}
                r={n.dot}
                fill={lit ? `hsl(${n.phaseDeg.toFixed(0)}, 72%, 56%)` : 'var(--faint)'}
                fillOpacity={lit ? 0.95 : 0.5}
                stroke={n.isTarget ? 'var(--entangle)' : 'none'}
                strokeWidth={n.isTarget ? 2 : 0}
              />
            );
          })}
        </svg>
      </div>
    </div>
  );
}

export default QSphere2D;
