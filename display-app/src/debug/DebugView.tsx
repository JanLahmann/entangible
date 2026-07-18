/**
 * DebugView (/debug) — booth-staff calibration screen.
 *
 * Left: the live annotated MJPEG preview served by the host at /debug/stream.
 * Right: a dense monospace dump of the latest `detection` + `status` frames.
 *
 * Everything here is read-only diagnostics; nothing feeds back to the host.
 */
import { useEntangibleState } from '../ws/useEntangibleState';
import { markerLabel } from './markerLabels';

function fmt(n: number | null | undefined, digits = 2): string {
  return typeof n === 'number' ? n.toFixed(digits) : '—';
}

export function DebugView() {
  const { detection, status, connectionState } = useEntangibleState();

  const board = detection?.board;
  const markers = detection?.markers ?? [];
  const warnings = detection?.warnings ?? [];

  return (
    <div className="debug">
      <div className="debug__left">
        <div className="debug__panel-label">annotated preview · /debug/stream</div>
        <img
          className="debug__stream"
          src="/debug/stream"
          alt="Live annotated camera preview"
        />
      </div>

      <div className="debug__right">
        <section className="debug__section">
          <h2>pipeline</h2>
          <table className="debug__kv">
            <tbody>
              <tr>
                <td>ws</td>
                <td>{connectionState}</td>
              </tr>
              <tr>
                <td>fps</td>
                <td>{fmt(detection?.fps, 1)}</td>
              </tr>
              <tr>
                <td>board found</td>
                <td>{board ? String(board.found) : '—'}</td>
              </tr>
              <tr>
                <td>corners</td>
                <td>{board ? `${board.corners}/4` : '—'}</td>
              </tr>
              <tr>
                <td>reproj err (mm)</td>
                <td>{fmt(board?.reprojectionErrorMm, 3)}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="debug__section">
          <h2>status</h2>
          <table className="debug__kv">
            <tbody>
              <tr>
                <td>camera</td>
                <td>
                  {status
                    ? `${status.camera.kind}${status.camera.name ? ` (${status.camera.name})` : ''} · ${
                        status.camera.connected ? 'connected' : 'offline'
                      }`
                    : '—'}
                </td>
              </tr>
              <tr>
                <td>backend</td>
                <td>
                  {status
                    ? `${status.backend.enabled ? 'enabled' : 'off'} · ${
                        status.backend.healthy ? 'healthy' : 'unhealthy'
                      }`
                    : '—'}
                </td>
              </tr>
              <tr>
                <td>clients</td>
                <td>{status ? status.clients : '—'}</td>
              </tr>
            </tbody>
          </table>
        </section>

        <section className="debug__section">
          <h2>markers ({markers.length})</h2>
          <table className="debug__table">
            <thead>
              <tr>
                <th>id</th>
                <th>gate</th>
                <th>row</th>
                <th>col</th>
                <th>off-grid</th>
              </tr>
            </thead>
            <tbody>
              {markers.length === 0 && (
                <tr>
                  <td colSpan={5} className="debug__muted">
                    no gate markers
                  </td>
                </tr>
              )}
              {markers.map((m, i) => (
                <tr key={`${m.id}-${i}`} className={m.offGrid ? 'debug__row-off' : ''}>
                  <td>{m.id}</td>
                  <td>{markerLabel(m.id)}</td>
                  <td>{m.row ?? '—'}</td>
                  <td>{m.col ?? '—'}</td>
                  <td>{m.offGrid ? 'yes' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section className="debug__section">
          <h2>warnings ({warnings.length})</h2>
          <table className="debug__table">
            <thead>
              <tr>
                <th>code</th>
                <th>row</th>
                <th>col</th>
                <th>message</th>
              </tr>
            </thead>
            <tbody>
              {warnings.length === 0 && (
                <tr>
                  <td colSpan={4} className="debug__muted">
                    none
                  </td>
                </tr>
              )}
              {warnings.map((w, i) => (
                <tr key={`${w.code}-${i}`}>
                  <td>{w.code}</td>
                  <td>{w.row ?? '—'}</td>
                  <td>{w.col ?? '—'}</td>
                  <td>{w.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

export default DebugView;
