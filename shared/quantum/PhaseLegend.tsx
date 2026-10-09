/**
 * PhaseLegend — a small phase color-wheel, shared by both apps.
 *
 * Mirrors the IBM Quantum Composer Q-sphere phase disc: a hue wheel using the
 * same `hsl(φ, 70%, 60%)` mapping as the nodes, with ticks at 0, π/2, π and
 * -π/2. Structural SVG only; `${classPrefix}-qs-legend*` classes carry styling.
 */
import { useT } from '@shared/i18n';

const WEDGES = 24; // 15° each
const TICKS: Array<{ deg: number; label: string }> = [
  { deg: 0, label: '0' },
  { deg: 90, label: 'π/2' },
  { deg: 180, label: 'π' },
  { deg: 270, label: '-π/2' },
];

/** Screen point for a hue angle (0°=east, 90°=north; SVG y is down). */
function polar(cx: number, cy: number, r: number, deg: number): [number, number] {
  const a = (deg * Math.PI) / 180;
  return [cx + r * Math.cos(a), cy - r * Math.sin(a)];
}

export function PhaseLegend({
  classPrefix,
  size = 54,
}: {
  classPrefix: string;
  size?: number;
}) {
  const p = classPrefix;
  const legendLabel = useT().evolving.phaseLegend;
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 12;

  const wedges = [];
  for (let i = 0; i < WEDGES; i++) {
    const a0 = (i * 360) / WEDGES;
    const a1 = ((i + 1) * 360) / WEDGES;
    const [x0, y0] = polar(cx, cy, r, a0);
    const [x1, y1] = polar(cx, cy, r, a1);
    const hue = (a0 + a1) / 2;
    wedges.push(
      <path
        key={i}
        d={`M ${cx} ${cy} L ${x0.toFixed(2)} ${y0.toFixed(2)} A ${r} ${r} 0 0 0 ${x1.toFixed(2)} ${y1.toFixed(2)} Z`}
        fill={`hsl(${hue.toFixed(0)}, 70%, 60%)`}
      />,
    );
  }

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      width={size}
      height={size}
      className={`${p}-qs-legend`}
      role="img"
      aria-label={legendLabel}
    >
      <g className={`${p}-qs-legend-wheel`}>{wedges}</g>
      <circle cx={cx} cy={cy} r={r * 0.42} className={`${p}-qs-legend-hub`} />
      {TICKS.map((t) => {
        const [lx, ly] = polar(cx, cy, r + 6, t.deg);
        return (
          <text
            key={t.deg}
            x={lx}
            y={ly}
            className={`${p}-qs-legend-tick`}
            textAnchor="middle"
            dominantBaseline="middle"
          >
            {t.label}
          </text>
        );
      })}
    </svg>
  );
}

export default PhaseLegend;
