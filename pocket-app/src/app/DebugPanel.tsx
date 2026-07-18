/**
 * Debug panel (docs/pocket.md) — the serverless equivalent of the booth's
 * /debug read-outs. Consumes the pipeline's per-frame FrameResult (detect
 * stats, corners, reprojection error, marker table, warnings, resolved detector
 * params) plus the live fps. Dense, monospace, pk-styled tables; appended below
 * the other panels and never shown to visitors.
 */
import type { FrameResult } from '../vision/pipeline';
import { MARKER_TABLE } from '../vision/markers';
import { CORNER_IDS } from '../vision/geometry';

function markerLabel(id: number): string {
  if (String(id) in CORNER_IDS) return `corner ${CORNER_IDS[String(id)]}`;
  return MARKER_TABLE.get(id)?.label ?? `#${id}`;
}

export function DebugPanel({ frame, fps }: { frame: FrameResult | null; fps: number }) {
  return (
    <div>
      <div className="pk-label">Debug</div>
      <div className="pk-well pk-debug">
        <table className="pk-dbg-tbl">
          <tbody>
            <tr>
              <td>fps</td>
              <td>{fps}</td>
              <td>candidates</td>
              <td>{frame?.stats.candidates ?? '—'}</td>
            </tr>
            <tr>
              <td>blind hits</td>
              <td>{frame?.stats.blindHits ?? '—'}</td>
              <td>guided</td>
              <td>{frame?.stats.guidedRescues ?? '—'}</td>
            </tr>
            <tr>
              <td>corners</td>
              <td>{frame?.corners ?? '—'}</td>
              <td>reproj mm</td>
              <td>
                {frame?.reprojectionErrorMm != null ? frame.reprojectionErrorMm.toFixed(2) : '—'}
              </td>
            </tr>
          </tbody>
        </table>

        <div className="pk-dbg-sub">markers</div>
        {frame && frame.markers.length > 0 ? (
          <table className="pk-dbg-tbl pk-dbg-markers">
            <thead>
              <tr>
                <th>id</th>
                <th>gate</th>
                <th>row</th>
                <th>col</th>
                <th>off</th>
              </tr>
            </thead>
            <tbody>
              {frame.markers.map((m, i) => (
                <tr key={`${m.id}-${i}`}>
                  <td>{m.id}</td>
                  <td>{markerLabel(m.id)}</td>
                  <td>{m.row ?? '·'}</td>
                  <td>{m.col ?? '·'}</td>
                  <td>{m.offGrid ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <div className="pk-dbg-empty">no tile markers</div>
        )}

        <div className="pk-dbg-sub">warnings</div>
        {frame && frame.warnings.length > 0 ? (
          <ul className="pk-dbg-warn">
            {frame.warnings.map((w, i) => (
              <li key={i}>
                [{w.kind}] {w.message}
              </li>
            ))}
          </ul>
        ) : (
          <div className="pk-dbg-empty">none</div>
        )}

        <div className="pk-dbg-sub">params (read-only)</div>
        {frame && (
          <table className="pk-dbg-tbl">
            <tbody>
              <tr>
                <td>guided</td>
                <td>{String(frame.params.guided)}</td>
                <td>subpixel</td>
                <td>{String(frame.params.subpixel)}</td>
              </tr>
              <tr>
                <td>robust</td>
                <td>{String(frame.params.robustSample)}</td>
                <td>minArea</td>
                <td>{frame.params.minArea}</td>
              </tr>
              <tr>
                <td>approxEps</td>
                <td>{frame.params.approxEpsilonFrac}</td>
                <td>thrWin</td>
                <td>{frame.params.thresholdWindow}</td>
              </tr>
              <tr>
                <td>thrC</td>
                <td>{frame.params.thresholdC}</td>
                <td />
                <td />
              </tr>
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

export default DebugPanel;
