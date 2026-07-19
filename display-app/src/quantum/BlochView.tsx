/**
 * BlochView — a 2D-projected Bloch sphere for Quantum Golf level 1.
 *
 * Shares the Q-sphere's projection + interaction machinery (`qsphere.ts`,
 * `useSphereRotation`): the reduced single-qubit Bloch vector `(x, y, z)` lives
 * in the same model space (z = pole axis), so |0⟩ sits at the top pole and |1⟩
 * at the bottom. Renders the sphere silhouette, an equator guide, the three
 * x/y/z axes with their letters, the six eigenstate kets (|0⟩/|1⟩ poles,
 * |+⟩/|−⟩ and |i+⟩/|i−⟩ on the equator), the state arrow + ball, and a purple
 * target flag at |+⟩. Axis halves and labels on the far hemisphere are
 * depth-dimmed (`FAR_DIM`); a custom default orientation (`BLOCH_DEFAULT_*`)
 * separates all six labels and keeps |0⟩ at the near pole. Level 1's "any qubit"
 * rule is handled by `bestBlochQubit`, so whichever qubit is in superposition
 * drives the view. Structural SVG only — `${classPrefix}-bl-*` classes style it.
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import { projectPoint } from './qsphere';
import {
  blochVector,
  bestBlochQubit,
  TARGET_PLUS,
  BLOCH_ENDPOINTS,
  BLOCH_DEFAULT_YAW,
  BLOCH_DEFAULT_PITCH,
  type BlochVector,
} from './bloch';
import { statevector, type StateVector } from './statevector';
import { useSphereRotation } from './useSphereRotation';
import { ResetOrientationButton } from './ResetOrientationButton';

const MARGIN = 26;
const GUIDE_SAMPLES = 48;
const FAR_DIM = 0.4; // opacity for axis halves / labels on the far hemisphere
const OUT_KET = 13; // px past the sphere surface for a state ket label
const OUT_LETTER = 9; // px past the surface for the axis letter (positive end)
const TAN_LETTER = 12; // tangential nudge so the axis letter clears its ket

export interface BlochViewProps {
  /** Provide a circuit (best superposition qubit auto-picked) or an explicit vector. */
  circuit?: Circuit;
  statevector?: StateVector;
  /** Force a specific qubit; otherwise the most-superposed qubit is chosen. */
  qubit?: number;
  size?: number;
  classPrefix: string;
  title?: string;
}

export function BlochView({
  circuit,
  statevector: svProp,
  qubit,
  size = 220,
  classPrefix,
  title = 'Bloch sphere state projection',
}: BlochViewProps) {
  const p = classPrefix;
  const sv = useMemo<StateVector>(
    () => svProp ?? (circuit ? statevector(circuit) : statevector({ qubits: 5, gates: [] } as Circuit)),
    [svProp, circuit],
  );
  const q = qubit ?? bestBlochQubit(sv);
  const vec: BlochVector = useMemo(() => blochVector(sv, q), [sv, q]);

  const { yaw, pitch, dragging, reset, handlers } = useSphereRotation({
    yaw: BLOCH_DEFAULT_YAW,
    pitch: BLOCH_DEFAULT_PITCH,
  });

  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - MARGIN;
  const sX = (x: number) => cx + x * R;
  const sY = (y: number) => cy + y * R;
  const pt = (v: { x: number; y: number; z: number }) => {
    const pr = projectPoint(v, yaw, pitch);
    return { x: sX(pr.x), y: sY(pr.y), depth: pr.depth };
  };

  // Equator guide (z = 0 latitude), sampled + projected.
  const equator = useMemo(() => {
    const pts: string[] = [];
    for (let k = 0; k <= GUIDE_SAMPLES; k++) {
      const t = (2 * Math.PI * k) / GUIDE_SAMPLES;
      const pr = projectPoint({ x: Math.cos(t), y: Math.sin(t), z: 0 }, yaw, pitch);
      pts.push(`${sX(pr.x).toFixed(2)},${sY(pr.y).toFixed(2)}`);
    }
    return pts.join(' ');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [yaw, pitch, size]);

  const state = pt(vec);
  const target = pt(TARGET_PLUS); // |+⟩

  // Axis lines + X/Y/Z letters + |ket⟩ labels for all six endpoints. Each end's
  // surface point drives its own depth-dim; labels are pushed a fixed number of
  // px past the silhouette along the projected radial (so they never fall inside
  // the sphere when an axis foreshortens toward the camera).
  const axes = BLOCH_ENDPOINTS.map((e) => {
    const surf = pt(e.dir); // sphere-surface screen point (foreshortens)
    const dx = surf.x - cx;
    const dy = surf.y - cy;
    const mag = Math.hypot(dx, dy);
    const ux = mag < 1e-3 ? 0 : dx / mag; // outward screen unit (fallback: up)
    const uy = mag < 1e-3 ? -1 : dy / mag;
    const dim = surf.depth < 0;
    return {
      ...e,
      surf,
      dim,
      ketPos: { x: cx + ux * (R + OUT_KET), y: cy + uy * (R + OUT_KET) },
      // axis letter: just outside the tip, nudged tangentially off the ket
      letterPos: {
        x: cx + ux * (R + OUT_LETTER) - uy * TAN_LETTER,
        y: cy + uy * (R + OUT_LETTER) + ux * TAN_LETTER,
      },
    };
  });

  return (
    <div className={`${p}-bloch`}>
      <ResetOrientationButton classPrefix={p} onReset={reset} />
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        className={`${p}-bl-svg`}
        role="img"
        aria-label={title}
        style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
        {...handlers}
      >
        <circle className={`${p}-bl-sphere`} cx={cx} cy={cy} r={R} />
        <polyline className={`${p}-bl-guide`} points={equator} fill="none" />

        {/* x/y/z axes: one hairline half per endpoint, far half dimmed */}
        {axes.map((a) => (
          <line
            key={`axis-${a.axis}-${a.sign}`}
            className={`${p}-bl-axis`}
            x1={cx}
            y1={cy}
            x2={a.surf.x}
            y2={a.surf.y}
            opacity={a.dim ? FAR_DIM : 1}
          />
        ))}

        {/* target flag at |+⟩ */}
        <g className={`${p}-bl-target`} opacity={target.depth < 0 ? 0.4 : 1}>
          <line x1={target.x} y1={target.y} x2={target.x} y2={target.y - 18} />
          <path d={`M ${target.x} ${target.y - 18} l 12 4 l -12 4 z`} />
          <circle cx={target.x} cy={target.y} r={3} />
        </g>

        {/* axis letters (positive ends only) + state kets (all six ends) */}
        {axes.map((a) =>
          a.axisLetter ? (
            <text
              key={`letter-${a.axis}`}
              className={`${p}-bl-axis-label`}
              x={a.letterPos.x}
              y={a.letterPos.y}
              textAnchor="middle"
              dominantBaseline="central"
              opacity={a.dim ? FAR_DIM : 1}
            >
              {a.axisLetter}
            </text>
          ) : null,
        )}
        {axes.map((a) => (
          <text
            key={`ket-${a.axis}-${a.sign}`}
            className={`${p}-bl-ket`}
            x={a.ketPos.x}
            y={a.ketPos.y}
            textAnchor="middle"
            dominantBaseline="central"
            opacity={a.dim ? FAR_DIM : 1}
          >
            {a.ket}
          </text>
        ))}

        {/* state arrow + ball */}
        <g opacity={state.depth < 0 ? 0.5 : 1}>
          <line className={`${p}-bl-arrow`} x1={cx} y1={cy} x2={state.x} y2={state.y} />
          <circle className={`${p}-bl-ball`} cx={state.x} cy={state.y} r={7} />
        </g>

        <text className={`${p}-bl-qubit`} x={size - 6} y={size - 6} textAnchor="end">
          q{q}
        </text>
      </svg>
    </div>
  );
}

export default BlochView;
