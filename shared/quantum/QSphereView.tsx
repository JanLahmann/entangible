/**
 * QSphereView — ONE structural SVG Q-sphere shared by both apps.
 *
 * Pure geometry comes from `qsphere.ts`; probability/phase visuals from
 * `basisVisuals` (IBM Composer convention — see qsphere.ts header). Unstyled by
 * design: every element carries a `${classPrefix}-qs-*` class so the booth
 * (`bo-`) and pocket (`pk-`) supply their own CSS. Nodes are depth-sorted
 * (painter's algorithm): the far hemisphere is drawn first and dimmed, then a
 * translucent sphere disc, then the near hemisphere on top. Node radius ∝
 * PROBABILITY p_k, fill = phase hue `hsl(φ_k, 70%, 60%)` where φ_k is relative to
 * the reference amplitude, stem opacity ∝ p_k. Zero-probability lattice points
 * render as tiny faint dots. Target basis states are outlined in `--entangle`.
 * Motion is view-only + drag-only (no auto-spin); a rewind-arrow button resets
 * orientation and a phase color-wheel legend sits in the corner.
 *
 * Readability layer (#58):
 *   - `targetState` draws a GHOST of the goal — a stroke-only ring at each
 *     populated target node (same probability→radius mapping as the live nodes)
 *     with a phase tick on the ring. Ghosts stay at FULL opacity on both
 *     hemispheres: they are informational, not depth cues.
 *   - Populated and target nodes get a `|bits⟩` ket label, offset radially
 *     outward so it never covers a stem. The whole 2^n lattice is NOT labelled.
 *   - The view auto-faces the action: a home orientation aimed at the weighted
 *     centroid of the target + live probability mass (see `useSphereRotation`).
 *
 * Roll-the-ball layer (#57): the optional `travelers` prop draws balls of
 * probability mass in transit across the surface. This view stays DUMB — it
 * renders exactly what it is handed (unit position, radius, hue, opacity);
 * `EvolvingState` owns the physics and the animation clock.
 */
import { useMemo } from 'react';
import type { Circuit } from '@qamposer/react';
import {
  DEFAULT_QUBITS,
  PROB_EPS,
  basisVisuals,
  faceOrientation,
  layout,
  project,
  projectPoint,
  ringLatitudes,
  type QNode,
} from './qsphere';
import { statevector, type StateVector } from './statevector';
import { useSphereRotation } from './useSphereRotation';
import { PhaseLegend } from './PhaseLegend';
import { ResetOrientationButton } from './ResetOrientationButton';

const MARGIN = 24;
const FAINT_NODE = 1; // tiny dot for p ≈ 0 lattice points
const MIN_NODE = 2.5; // smallest populated-node radius
const MAX_NODE = 13; // radius at p = 1
const FAR_OPACITY = 0.32;
const GUIDE_SAMPLES = 48;
const TARGET_EPS = 1e-6; // target amplitudes below this get no ghost
const LABEL_PROB = 0.02; // populated enough to earn a ket label
const LABEL_GAP = 4; // px between the node/ghost edge and its label
const TICK_LEN = 4; // phase-tick length outside the ghost ring
const HOME_MIN_NORM = 0.15; // below this the mass is too symmetric to face

/**
 * A ball of probability mass in transit across the sphere (#57). Position is a
 * UNIT model-space vector (same frame as the lattice nodes); `hue` is degrees
 * on the phase wheel, matching the node fill convention.
 */
export interface QTraveler {
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly hue: number;
  readonly opacity: number;
}

/**
 * The node radius for a probability — the single source of the probability →
 * radius mapping, so travelers are sized on exactly the scale the nodes use.
 */
export function nodeRadius(prob: number): number {
  return prob < PROB_EPS ? FAINT_NODE : MIN_NODE + (MAX_NODE - MIN_NODE) * prob;
}

export interface QSphereViewProps {
  /** Provide a circuit (simulated) or a precomputed statevector. */
  circuit?: Circuit;
  statevector?: StateVector;
  /** Qubit count of the displayed space (2^n nodes). Defaults to 5. */
  n?: number;
  /** Basis indices to outline as targets (golf). */
  targets?: ReadonlySet<number>;
  /** The goal state: drawn as ghost rings + phase ticks, and outlined like
   *  `targets` (so a caller can pass this alone). */
  targetState?: StateVector;
  /** Balls of probability mass in transit (#57) — rendered as given. */
  travelers?: readonly QTraveler[];
  /** SVG viewBox size (square). */
  size?: number;
  /** Class prefix for CSS hooks, e.g. 'bo' or 'pk'. */
  classPrefix: string;
  /** Accessible label. */
  title?: string;
}

interface NodeDraw {
  index: number;
  sx: number;
  sy: number;
  depth: number;
  prob: number;
  phaseDeg: number;
  radius: number;
  faint: boolean;
  isTarget: boolean;
  /** Target probability (0 = no ghost) and its ghost-ring radius. */
  targetProb: number;
  targetRadius: number;
  targetPhaseDeg: number;
  /** Basis bitstring, MSB-first (qubit n-1 … qubit 0) — the counts-key form. */
  bits: string;
}

export function QSphereView({
  circuit,
  statevector: svProp,
  n = DEFAULT_QUBITS,
  targets,
  targetState,
  travelers,
  size = 220,
  classPrefix,
  title = 'Q-sphere state projection',
}: QSphereViewProps) {
  const p = classPrefix;
  const sv = useMemo<StateVector>(
    () => svProp ?? (circuit ? statevector(circuit) : statevector({ qubits: n, gates: [] } as Circuit)),
    [svProp, circuit, n],
  );
  const nodes = useMemo<QNode[]>(() => layout(n), [n]);
  const lats = useMemo(() => ringLatitudes(n), [n]);

  const liveVisuals = useMemo(() => basisVisuals(sv, 1 << n), [sv, n]);
  const targetVisuals = useMemo(
    () => (targetState ? basisVisuals(targetState, 1 << n) : null),
    [targetState, n],
  );

  // Auto-face: point the camera at the weighted centroid of the interesting
  // mass. With a goal (`targetState`) the camera faces the GOAL only — the
  // target is stable per hole, so the view holds still while the evolution
  // animation plays instead of chasing the tweened state. Without a goal it
  // faces the live probability mass. A near-zero centroid means the state is
  // symmetric (or empty) and no direction is more informative than the default.
  const home = useMemo(() => {
    const weights = targetVisuals ?? liveVisuals;
    let x = 0;
    let y = 0;
    let z = 0;
    let total = 0;
    for (const node of nodes) {
      const w = weights[node.index]?.prob ?? 0;
      if (w <= 0) continue;
      x += w * node.pos.x;
      y += w * node.pos.y;
      z += w * node.pos.z;
      total += w;
    }
    if (total <= 0) return undefined;
    const len = Math.hypot(x, y, z) / total;
    if (len < HOME_MIN_NORM) return undefined;
    return faceOrientation({ x, y, z });
  }, [nodes, liveVisuals, targetVisuals]);

  const { yaw, pitch, dragging, reset, handlers } = useSphereRotation({ home });

  const cx = size / 2;
  const cy = size / 2;
  const R = size / 2 - MARGIN;
  const toScreenX = (x: number) => cx + x * R;
  const toScreenY = (y: number) => cy + y * R;

  const projected = useMemo(() => project(nodes, yaw, pitch), [nodes, yaw, pitch]);

  const draws = useMemo<NodeDraw[]>(() => {
    const out: NodeDraw[] = projected.map((pr) => {
      const v = liveVisuals[pr.index];
      const radius = nodeRadius(v.prob);
      const tv = targetVisuals?.[pr.index];
      const targetProb = tv && tv.prob > TARGET_EPS ? tv.prob : 0;
      return {
        index: pr.index,
        sx: toScreenX(pr.x),
        sy: toScreenY(pr.y),
        depth: pr.depth,
        prob: v.prob,
        phaseDeg: v.phaseDeg,
        radius,
        faint: v.faint,
        isTarget: (targets?.has(pr.index) ?? false) || targetProb > 0,
        targetProb,
        targetRadius: MIN_NODE + (MAX_NODE - MIN_NODE) * targetProb,
        targetPhaseDeg: tv?.phaseDeg ?? 0,
        bits: pr.index.toString(2).padStart(n, '0'),
      };
    });
    // Painter's algorithm: far (small depth) first, near last.
    out.sort((a, b) => a.depth - b.depth);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projected, liveVisuals, targetVisuals, targets, size, n]);

  // Guide latitude rings, sampled + projected into screen polylines.
  const guides = useMemo(() => {
    return lats.map(({ z, r }) => {
      const pts: string[] = [];
      for (let k = 0; k <= GUIDE_SAMPLES; k++) {
        const t = (2 * Math.PI * k) / GUIDE_SAMPLES;
        const pr = projectPoint({ x: r * Math.cos(t), y: r * Math.sin(t), z }, yaw, pitch);
        pts.push(`${toScreenX(pr.x).toFixed(2)},${toScreenY(pr.y).toFixed(2)}`);
      }
      return pts.join(' ');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lats, yaw, pitch, size]);

  const near = draws.filter((d) => d.depth >= 0);
  const far = draws.filter((d) => d.depth < 0);

  // Travelers: same projection + painter's ordering as the nodes, so a ball
  // rolling round the back really does pass behind the sphere disc.
  const travelerDraws = useMemo(() => {
    return (travelers ?? [])
      .map((t, i) => {
        const pr = projectPoint({ x: t.x, y: t.y, z: t.z }, yaw, pitch);
        return { id: i, t, sx: toScreenX(pr.x), sy: toScreenY(pr.y), depth: pr.depth };
      })
      .sort((a, b) => a.depth - b.depth);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [travelers, yaw, pitch, size]);
  const nearTravelers = travelerDraws.filter((d) => d.depth >= 0);
  const farTravelers = travelerDraws.filter((d) => d.depth < 0);

  const renderTraveler = (d: (typeof travelerDraws)[number]) => (
    <circle
      key={`traveler-${d.id}`}
      className={`${p}-qs-traveler`}
      cx={d.sx}
      cy={d.sy}
      r={d.t.radius}
      fill={`hsl(${d.t.hue.toFixed(0)}, 70%, 60%)`}
      // Far-side balls dim exactly like far-side nodes, on top of their own
      // travel fade — depth stays readable while the ball crosses the horizon.
      fillOpacity={d.t.opacity * (d.depth < 0 ? FAR_OPACITY : 1)}
      pointerEvents="none"
    />
  );

  const renderNode = (d: NodeDraw) => {
    const dim = d.depth < 0;
    const groupOpacity = dim ? FAR_OPACITY : 1;
    return (
      <g key={d.index} className={`${p}-qs-node`} opacity={groupOpacity}>
        {!d.faint && (
          <line
            className={`${p}-qs-stem`}
            x1={cx}
            y1={cy}
            x2={d.sx}
            y2={d.sy}
            strokeOpacity={Math.max(0.08, d.prob)}
          />
        )}
        <circle
          className={`${p}-qs-dot${d.isTarget ? ` ${p}-qs-dot--target` : ''}`}
          cx={d.sx}
          cy={d.sy}
          r={d.radius}
          fill={d.faint ? 'var(--faint, #5c6370)' : `hsl(${d.phaseDeg.toFixed(0)}, 70%, 60%)`}
          fillOpacity={d.faint ? 0.5 : 0.96}
          stroke={d.isTarget ? 'var(--entangle, #7a5cff)' : 'none'}
          strokeWidth={d.isTarget ? 2 : 0}
        />
      </g>
    );
  };

  // Ghost of the goal: a stroke-only ring sized by TARGET probability, with a
  // tick on the ring at the target phase (0° = east, counter-clockwise — the
  // phase-legend convention). Never dimmed: the ghost is the instruction.
  const renderGhost = (d: NodeDraw) => {
    if (d.targetProb <= 0) return null;
    const a = (d.targetPhaseDeg * Math.PI) / 180;
    const ux = Math.cos(a);
    const uy = -Math.sin(a);
    return (
      <g key={`ghost-${d.index}`} className={`${p}-qs-target`}>
        <circle
          className={`${p}-qs-target-ring`}
          cx={d.sx}
          cy={d.sy}
          r={d.targetRadius}
          fill="none"
          stroke="var(--entangle, #7a5cff)"
        />
        <line
          className={`${p}-qs-target-tick`}
          x1={d.sx + ux * d.targetRadius}
          y1={d.sy + uy * d.targetRadius}
          x2={d.sx + ux * (d.targetRadius + TICK_LEN)}
          y2={d.sy + uy * (d.targetRadius + TICK_LEN)}
          stroke="var(--entangle, #7a5cff)"
        />
      </g>
    );
  };

  const renderLabel = (d: NodeDraw) => {
    const populated = d.prob > LABEL_PROB;
    if (!populated && !d.isTarget) return null;
    // Push the label radially outward from the sphere centre so it clears the
    // node, its ghost ring and the stem. A node projected onto the centre has
    // no radial direction — nudge it straight up instead.
    const dx = d.sx - cx;
    const dy = d.sy - cy;
    const len = Math.hypot(dx, dy);
    const ux = len < 0.5 ? 0 : dx / len;
    const uy = len < 0.5 ? -1 : dy / len;
    const off = Math.max(d.radius, d.targetRadius) + LABEL_GAP;
    return (
      <text
        key={`label-${d.index}`}
        className={`${p}-qs-label`}
        x={d.sx + ux * off}
        y={d.sy + uy * off}
        textAnchor="middle"
        dominantBaseline="middle"
        // Target-only labels stay legible on the far side; a populated node's
        // label follows the node's depth dim.
        opacity={d.depth < 0 && populated ? FAR_OPACITY : 1}
      >
        |{d.bits}⟩
      </text>
    );
  };

  return (
    <div className={`${p}-qsphere`}>
      <ResetOrientationButton classPrefix={p} onReset={reset} />
      <svg
        viewBox={`0 0 ${size} ${size}`}
        width="100%"
        className={`${p}-qs-svg`}
        role="img"
        aria-label={title}
        style={{ touchAction: 'none', cursor: dragging ? 'grabbing' : 'grab' }}
        {...handlers}
      >
        {/* silhouette + latitude guides */}
        <circle className={`${p}-qs-sphere`} cx={cx} cy={cy} r={R} />
        {guides.map((pts, i) => (
          <polyline key={i} className={`${p}-qs-guide`} points={pts} fill="none" />
        ))}
        {/* far hemisphere (dimmed, behind the disc) */}
        {far.map(renderNode)}
        {far.map(renderGhost)}
        {farTravelers.map(renderTraveler)}
        {far.map(renderLabel)}
        {/* translucent sphere disc separates the hemispheres */}
        <circle className={`${p}-qs-disc`} cx={cx} cy={cy} r={R} />
        {/* near hemisphere (on top) */}
        {near.map(renderNode)}
        {near.map(renderGhost)}
        {nearTravelers.map(renderTraveler)}
        {near.map(renderLabel)}
      </svg>
      <div className={`${p}-qs-legend-wrap`}>
        <PhaseLegend classPrefix={p} />
      </div>
    </div>
  );
}

export default QSphereView;
