/**
 * DebugView (/debug) — booth-staff calibration screen. Ported from the former
 * display-app debug surface into the unified pocket app (Entangible One, phase
 * U3); the host serves the pocket SPA at `/debug` and the app routes to this
 * component on `location.pathname` (see `../app/surface`).
 *
 * Left: the live annotated MJPEG preview served by the host at /debug/stream.
 * Right: a dense monospace dump of the latest `detection` + `status` frames,
 * plus the staff Layout card.
 *
 * This is the ONLY pocket surface that authenticates as an OPERATOR and sends
 * `select_layout` / `select_mode` (via the isolated `./debugSocket`) — the
 * viewer-policy exception. Everything else here is read-only diagnostics.
 */
import { useEffect, useState, type CSSProperties } from 'react';
import { useDebugState } from './debugSocket';
import { getDebugSocket } from './debugSocket';
import {
  clearOperatorKey,
  getOperatorKey,
  storeOperatorKey,
  withKey,
} from '@shared/ws/operatorKey';
import type { DisplayMode, NoisePreset, ShotSource, SidebarSide, Wires } from '@shared/ws/messages';
import { BUILTIN_PACKS } from '@shared/menu/builtinPacks';
import { cryptoRng } from '@shared/menu/sample';
import { menuOutcomes, serveFrom } from '../app/quantina';
import { useResolvedPack } from '../app/packSource';
import { noiseSeries } from '../app/ResultsHistogram';
import { markerLabel } from './markerLabels';
import './debug.css';

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
          src={withKey('/api/qr')}
          alt="QR code opening the pocket camera role"
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

/** Booth-wide noise-model presets (one per IBM chip generation, plus off). */
const NOISE_PRESETS: NoisePreset[] = ['off', 'falcon', 'eagle', 'heron', 'nighthawk'];

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
 * The kiosk/viewers consume the broadcast — this card never touches them
 * directly. This is the pocket app's ONLY `select_*` send site (operator only).
 */
function LayoutCard() {
  const { layout } = useDebugState();
  const socket = getDebugSocket();

  const mode = layout?.mode;
  const sidebar = layout?.sidebar;
  const panels = layout?.panels ?? [];
  const wires = layout?.wires;
  const noise = layout?.noise;

  // Registry order first, then any live panels not in the registry.
  const knownPanels = [
    ...PANEL_REGISTRY,
    ...panels.filter((p) => !PANEL_REGISTRY.includes(p)),
  ];

  const setMode = (m: DisplayMode) => socket.sendMessage({ type: 'select_mode', mode: m });
  const setSidebar = (s: SidebarSide) =>
    socket.sendMessage({ type: 'select_layout', sidebar: s });
  const setWires = (w: Wires) =>
    socket.sendMessage({ type: 'select_layout', wires: w });
  const setNoise = (n: NoisePreset) =>
    socket.sendMessage({ type: 'select_noise', preset: n });
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

      <div style={{ marginBottom: '0.9rem' }}>
        <div style={{ color: 'var(--ent-text-dim)', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
          wires
        </div>
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {(['compact', 'all'] as Wires[]).map((w) => (
            <button
              key={w}
              type="button"
              style={pillStyle(wires === w)}
              onClick={() => setWires(w)}
            >
              {w}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '0.9rem' }}>
        <div style={{ color: 'var(--ent-text-dim)', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
          noise
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {NOISE_PRESETS.map((n) => (
            <button
              key={n}
              type="button"
              style={pillStyle(noise === n)}
              onClick={() => setNoise(n)}
            >
              {n}
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

/** The bundled menu-pack ids, always offered by the /debug pack picker. */
const BUILTIN_PACK_IDS = BUILTIN_PACKS.map((p) => p.id);

/**
 * "Quantina" card (operator surface): the staff serving controls for
 * `quantina` mode (docs/quantina.md). It (a) picks the active menu pack
 * (`select_menu`), (b) serves from the live circuit + the booth noise preset —
 * the SAME `menuOutcomes` math the menu shows, sampled here with `cryptoRng` —
 * (`serve` with shotSource ideal/noisy), and (c) enters a visitor's
 * real-hardware bitstring (`serve` shotSource 'real'; decision 5). The host
 * stamps + broadcasts `served` to every screen. Serve is disabled outside
 * quantina mode (nothing to reveal) and when no pack is active.
 */
function QuantinaCard() {
  const { layout, circuit } = useDebugState();
  const socket = getDebugSocket();

  const menuId = layout?.menu ?? null;
  const isQuantina = layout?.mode === 'quantina';
  const noise: NoisePreset = layout?.noise ?? 'off';
  // Active pack: built-in, or a custom host-served pack (fetched same-origin);
  // protocol null/unknown → coffee (the same fallback clients use). Resolving the
  // real pack keeps the serve card's qubit count + shot bounds correct for a
  // custom pack, not just coffee.
  const { pack } = useResolvedPack(menuId);
  const shotsBounds = pack.serve.shots;

  // Custom host-served pack ids (built-ins live in the bundle) — fetched once and
  // appended to the picker so staff can activate a dropped-in pack from /debug.
  const [hostPackIds, setHostPackIds] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/menu/packs')
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { packs?: { id: string }[] } | null) => {
        if (cancelled || !data || !Array.isArray(data.packs)) return;
        setHostPackIds(
          data.packs.map((p) => p.id).filter((id) => !BUILTIN_PACK_IDS.includes(id)),
        );
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const [count, setCount] = useState<number>(shotsBounds?.default ?? 1);
  useEffect(() => {
    setCount(pack.serve.shots?.default ?? 1);
  }, [pack]);

  // Real-hardware entry: exactly `pack.qubits` chars of 0/1 (live-validated).
  const [realBits, setRealBits] = useState('');
  const realValid = realBits.length === pack.qubits && /^[01]+$/.test(realBits);

  const canServe = isQuantina && !!circuit?.circuit;

  const setPack = (id: string) => socket.sendMessage({ type: 'select_menu', pack: id });

  const doServe = () => {
    const live = circuit?.circuit;
    if (!live) return;
    // Sample where the simulation runs: the noisy vector when a preset is on
    // (else ideal), marginalized onto the pack — byte-identical to the menu.
    const noisyProbs = noiseSeries(live, noise, false);
    const outcomes = menuOutcomes(live, pack, noisyProbs);
    const shotSource: ShotSource = noisyProbs ? 'noisy' : 'ideal';
    const result = serveFrom(outcomes, pack, count, cryptoRng(), shotSource);
    socket.sendMessage({ type: 'serve', outcomes: result.outcomes, shotSource });
  };

  const doRealServe = () => {
    if (!realValid) return;
    socket.sendMessage({ type: 'serve', outcomes: [realBits], shotSource: 'real' });
    setRealBits('');
  };

  const pillStyle = (active: boolean): CSSProperties => ({
    padding: '0.3rem 0.8rem',
    borderRadius: 999,
    border: '1px solid var(--ent-border, #333)',
    background: active ? 'var(--ent-accent, #0f62fe)' : 'transparent',
    color: active ? '#fff' : 'var(--ent-text, #e6e6ea)',
    cursor: 'pointer',
    fontSize: '0.85rem',
  });

  const inputStyle: CSSProperties = {
    fontFamily: 'var(--ent-mono)',
    padding: '0.3rem 0.5rem',
    borderRadius: 6,
    border: '1px solid var(--ent-border, #333)',
    background: 'transparent',
    color: 'var(--ent-text, #e6e6ea)',
  };

  return (
    <section className="debug__section">
      <h2>quantina</h2>
      {!isQuantina && (
        <div className="debug__muted" style={{ marginBottom: '0.75rem' }}>
          switch mode to <strong>quantina</strong> (Layout card) to serve.
        </div>
      )}

      <div style={{ marginBottom: '0.9rem' }}>
        <div style={{ color: 'var(--ent-text-dim)', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
          menu pack{menuId ? '' : ' (none → coffee)'}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          {BUILTIN_PACK_IDS.map((id) => (
            <button
              key={id}
              type="button"
              style={pillStyle(menuId === id)}
              onClick={() => setPack(id)}
            >
              {id}
            </button>
          ))}
          {/* Custom host packs — dashed outline + a ·host suffix to distinguish
              them from the bundled built-ins. */}
          {hostPackIds.map((id) => (
            <button
              key={id}
              type="button"
              style={{ ...pillStyle(menuId === id), borderStyle: 'dashed' }}
              onClick={() => setPack(id)}
            >
              {id}·host
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginBottom: '0.9rem' }}>
        <div style={{ color: 'var(--ent-text-dim)', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
          serve · {pack.title} · {pack.serve.mode}
          {noise !== 'off' ? ` · noisy (${noise})` : ' · ideal'}
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          {shotsBounds && shotsBounds.max > shotsBounds.min && (
            <label style={{ display: 'flex', alignItems: 'center', gap: '0.35rem', fontSize: '0.85rem' }}>
              shots
              <input
                type="number"
                min={shotsBounds.min}
                max={shotsBounds.max}
                value={count}
                onChange={(e) => {
                  const n = Number(e.target.value);
                  if (Number.isFinite(n)) {
                    setCount(Math.min(shotsBounds.max, Math.max(shotsBounds.min, Math.round(n))));
                  }
                }}
                style={{ ...inputStyle, width: '4rem' }}
              />
            </label>
          )}
          <button
            type="button"
            style={{ ...pillStyle(false), opacity: canServe ? 1 : 0.5, cursor: canServe ? 'pointer' : 'default' }}
            disabled={!canServe}
            onClick={doServe}
          >
            Serve
          </button>
        </div>
      </div>

      <div>
        <div style={{ color: 'var(--ent-text-dim)', fontSize: '0.8rem', marginBottom: '0.35rem' }}>
          real hardware ({pack.qubits} bits)
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', alignItems: 'center', flexWrap: 'wrap' }}>
          <input
            type="text"
            inputMode="numeric"
            value={realBits}
            placeholder={'0'.repeat(pack.qubits)}
            onChange={(e) => setRealBits(e.target.value.replace(/[^01]/g, '').slice(0, pack.qubits))}
            aria-label="real hardware bitstring"
            style={{ ...inputStyle, width: '8rem' }}
          />
          <button
            type="button"
            style={{ ...pillStyle(false), opacity: realValid ? 1 : 0.5, cursor: realValid ? 'pointer' : 'default' }}
            disabled={!realValid}
            onClick={doRealServe}
          >
            Enter real result
          </button>
        </div>
        <div className="debug__muted" style={{ fontSize: '0.75rem', marginTop: '0.35rem' }}>
          The visitor runs the circuit on their own device with ONE shot, then
          tells you the measured bitstring.
        </div>
      </div>
    </section>
  );
}

/**
 * Operator-key prompt shown on a keyless `/debug` visit. The staff QR opens
 * `/debug?key=…` (auto-stored, no prompt); typing the token here stores it and
 * reloads so the preview/QR/WS all pick it up.
 */
function OperatorKeyPrompt({ rejected }: { rejected?: boolean }) {
  const [value, setValue] = useState('');
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const key = value.trim();
    if (!key) return;
    storeOperatorKey(key);
    globalThis.location?.reload();
  };
  return (
    <div className="debug" style={{ display: 'grid', placeItems: 'center' }}>
      <section className="debug__section" style={{ maxWidth: '30rem', width: '100%' }}>
        <h2>operator key required</h2>
        <p className="debug__muted" style={{ marginBottom: '0.75rem' }}>
          {rejected
            ? 'That key was rejected. Enter the current booth operator token.'
            : 'Enter the booth operator token, or open /debug from the staff QR.'}
        </p>
        <form onSubmit={submit} style={{ display: 'flex', gap: '0.5rem' }}>
          <input
            type="text"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder="operator token"
            autoFocus
            style={{
              flex: 1,
              fontFamily: 'var(--ent-mono)',
              padding: '0.4rem 0.6rem',
              borderRadius: 6,
              border: '1px solid var(--ent-border, #333)',
              background: 'transparent',
              color: 'var(--ent-text, #e6e6ea)',
            }}
          />
          <button type="submit" style={{ padding: '0.4rem 1rem', borderRadius: 6 }}>
            Unlock
          </button>
        </form>
      </section>
    </div>
  );
}

export function DebugView() {
  const { detection, status, connectionState, operator } = useDebugState();

  // Gate the staff diagnostics behind the operator key. The page shell is
  // served openly by the host; the key lives client-side (localStorage / the
  // `?key=` the staff QR carries) and is appended to the gated data requests.
  const hasKey = getOperatorKey() !== null;
  if (!hasKey) return <OperatorKeyPrompt />;
  // A stored-but-wrong key: the socket's hello_ack came back as a viewer.
  if (operator === false) return <OperatorKeyPrompt rejected />;

  const board = detection?.board;
  const markers = detection?.markers ?? [];
  const warnings = detection?.warnings ?? [];

  const clearKey = () => {
    clearOperatorKey();
    globalThis.location?.reload();
  };

  return (
    <div className="debug">
      <div className="debug__left">
        <div className="debug__panel-label">
          annotated preview · /debug/stream
          <button
            type="button"
            onClick={clearKey}
            title="Forget the operator key on this device"
            style={{
              marginLeft: '0.75rem',
              padding: '0.1rem 0.5rem',
              fontSize: '0.75rem',
              borderRadius: 4,
              cursor: 'pointer',
            }}
          >
            change key
          </button>
        </div>
        <img
          className="debug__stream"
          src={withKey('/debug/stream')}
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

        <QuantinaCard />

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
