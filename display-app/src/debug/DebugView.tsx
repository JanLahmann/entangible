/**
 * DebugView (/debug) — booth-staff calibration screen.
 *
 * Left: the live annotated MJPEG preview served by the host at /debug/stream.
 * Right: a dense monospace dump of the latest `detection` + `status` frames.
 *
 * Everything here is read-only diagnostics; nothing feeds back to the host.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useEntangibleState } from '../ws/useEntangibleState';
import { getStateSocket } from '../ws/stateSocket';
import type { DisplayMode, SidebarSide } from '../ws/messages';
import { markerLabel } from './markerLabels';

function fmt(n: number | null | undefined, digits = 2): string {
  return typeof n === 'number' ? n.toFixed(digits) : '—';
}

interface HostInfo {
  lanIp: string;
  port: number;
  tls: boolean;
  captureUrl: string;
}

/** "Phone camera" card: QR + capture URL + iOS cert tap-through steps. */
function PhoneCameraCard() {
  const [info, setInfo] = useState<HostInfo | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/info')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: HostInfo | null) => {
        if (!cancelled) setInfo(data);
      })
      .catch(() => {
        if (!cancelled) setInfo(null);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="debug__section">
      <h2>phone camera</h2>
      <div style={{ display: 'flex', gap: '1rem', alignItems: 'flex-start', flexWrap: 'wrap' }}>
        <img
          src="/api/qr?path=/capture"
          alt="QR code linking to the /capture page"
          width={168}
          height={168}
          style={{ background: '#fff', padding: 8, borderRadius: 6, flex: 'none' }}
        />
        <div style={{ minWidth: '14rem', flex: 1 }}>
          <div style={{ marginBottom: '0.5rem' }}>
            Scan to stream a phone camera to the booth:
          </div>
          <div
            style={{
              fontFamily: 'var(--ent-mono)',
              wordBreak: 'break-all',
              color: 'var(--ent-text)',
              marginBottom: '0.75rem',
            }}
          >
            {info ? info.captureUrl : '…'}
            {info && !info.tls ? '  (HTTP — no cert needed)' : ''}
          </div>
          <div style={{ color: 'var(--ent-text-dim)', fontSize: '0.85rem', lineHeight: 1.5 }}>
            <strong>iOS Safari (self-signed cert):</strong>
            <ol style={{ margin: '0.35rem 0 0', paddingLeft: '1.2rem' }}>
              <li>Open the link (scan the QR).</li>
              <li>
                Tap <strong>Show Details → visit this website</strong> (or{' '}
                <strong>Advanced</strong>), then <strong>Proceed</strong>.
              </li>
              <li>
                Tap <strong>Start camera</strong> and <strong>Allow</strong> camera access.
              </li>
            </ol>
          </div>
        </div>
      </div>
    </section>
  );
}

const DISPLAY_MODES: DisplayMode[] = ['composer', 'golf', 'attract'];

/** Known panel registry names (booth-v2). Live layout may add more. */
const PANEL_REGISTRY = [
  'results',
  'state',
  'qasm',
  'qsphere',
  'scorecard',
  'minicircuit',
  'branding',
];

/**
 * "Layout" card: staff-facing mode/panel/sidebar controls. Reflects the live
 * `layout` message and pushes `select_mode` / `select_layout` back to the host.
 * The booth screen consumes the broadcast — this card never touches it directly.
 */
function LayoutCard() {
  const { layout } = useEntangibleState();
  const socket = getStateSocket();

  const mode = layout?.mode;
  const sidebar = layout?.sidebar;
  const panels = layout?.panels ?? [];

  // Registry order first, then any live panels not in the registry.
  const knownPanels = [
    ...PANEL_REGISTRY,
    ...panels.filter((p) => !PANEL_REGISTRY.includes(p)),
  ];

  const setMode = (m: DisplayMode) => socket.sendMessage({ type: 'select_mode', mode: m });
  const setSidebar = (s: SidebarSide) =>
    socket.sendMessage({ type: 'select_layout', sidebar: s });
  const togglePanel = (panel: string, show: boolean) => {
    const next = show
      ? [...panels, panel]
      : panels.filter((p) => p !== panel);
    socket.sendMessage({ type: 'select_layout', panels: next });
  };

  const pillStyle = (active: boolean): CSSProperties => ({
    padding: '0.3rem 0.8rem',
    borderRadius: 999,
    border: '1px solid var(--ent-border, #333)',
    background: active ? 'var(--ent-accent, #0f62fe)' : 'transparent',
    color: active ? '#fff' : 'var(--ent-text, #e6e6ea)',
    cursor: 'pointer',
    fontSize: '0.85rem',
    textTransform: 'capitalize',
  });

  return (
    <section className="debug__section">
      <h2>layout</h2>
      {!layout && (
        <div className="debug__muted" style={{ marginBottom: '0.75rem' }}>
          waiting for layout from host…
        </div>
      )}

      <div style={{ marginBottom: '0.9rem' }}>
        <div style={{ color: 'var(--ent-text-dim)', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
          mode
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {DISPLAY_MODES.map((m) => (
            <button
              key={m}
              type="button"
              style={pillStyle(mode === m)}
              onClick={() => setMode(m)}
            >
              {m}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '0.9rem' }}>
        <div style={{ color: 'var(--ent-text-dim)', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
          sidebar
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['left', 'right'] as SidebarSide[]).map((s) => (
            <button
              key={s}
              type="button"
              style={pillStyle(sidebar === s)}
              onClick={() => setSidebar(s)}
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      <div>
        <div style={{ color: 'var(--ent-text-dim)', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
          panels
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.25rem' }}>
          {knownPanels.map((panel) => {
            const visible = panels.includes(panel);
            return (
              <label
                key={panel}
                style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.9rem' }}
              >
                <input
                  type="checkbox"
                  checked={visible}
                  disabled={!layout}
                  onChange={(e) => togglePanel(panel, e.target.checked)}
                />
                <span style={{ fontFamily: 'var(--ent-mono)' }}>{panel}</span>
                {visible && (
                  <span className="debug__muted" style={{ fontSize: '0.75rem' }}>
                    #{panels.indexOf(panel) + 1}
                  </span>
                )}
              </label>
            );
          })}
        </div>
      </div>
    </section>
  );
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

        <LayoutCard />

        {/* Volatile, per-frame lists live at the bottom (min-height reserved)
            so their constant resizing never shifts the stable cards above. */}
        <section className="debug__section" style={{ minHeight: '16rem' }}>
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

        <section className="debug__section" style={{ minHeight: '10rem' }}>
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

        <PhoneCameraCard />
      </div>
    </div>
  );
}

export default DebugView;
