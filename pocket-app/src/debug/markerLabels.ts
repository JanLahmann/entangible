/**
 * Best-effort marker-id → human label map for the /debug view only. Ported from
 * the former display-app debug surface (Entangible One, phase U3).
 *
 * The authoritative table is `MARKER_TABLE` in `qamposer-vision/markers.py`
 * (mirrored in `docs/marker-ids.md`). This copy exists purely so booth staff can
 * eyeball which tile a marker id is; it is NOT part of the wire protocol and is
 * intentionally forgiving about unknown ids.
 */
export const MARKER_LABELS: Record<number, string> = {
  10: 'RZ(π)',
  12: 'Y',
  13: 'Z',
  15: 'CNOT ⊕',
  17: 'CNOT ●',
  20: 'RX(π/4)',
  21: 'RX(π/2)',
  22: 'RX(π)',
  23: 'RX(-π/2)',
  24: 'RY(π/4)',
  25: 'RY(π/2)',
  26: 'RY(π)',
  27: 'RY(-π/2)',
  28: 'RZ(π/4)',
  29: 'RZ(π/2)',
  30: 'H',
  31: 'RZ(-π/2)',
  35: 'X',
};

export function markerLabel(id: number): string {
  return MARKER_LABELS[id] ?? `#${id}`;
}
