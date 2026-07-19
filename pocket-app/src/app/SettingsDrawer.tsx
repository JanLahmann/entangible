/**
 * Settings drawer (docs/pocket.md) — a gear pill in the topbar opens a
 * right-side overlay (pk styling, hairline border, 200 ms slide-in, ESC /
 * backdrop close). Sections: MODE, PANELS, SIDEBAR SIDE, LOW-POWER, DEBUG. All
 * touch targets ≥ 44 px. Changes go straight through the settings store (which
 * persists and clears the matching URL override).
 */
import { useCallback, useEffect, useState } from 'react';
import {
  PANEL_IDS,
  settingsStore,
  useSettings,
  type Mode,
  type PanelId,
  type Side,
  type Wires,
} from './settings';
import {
  enumerateCameras,
  hasOnlyPlaceholders,
  subscribeDeviceChange,
  type CameraDevice,
} from './cameraDevices';
import { boothLink, useBoothLink } from './boothLink';
import { normalizeBoothUrl } from '../sources/boothUrl';

const PANEL_LABELS: Record<PanelId, string> = {
  camera: 'Camera preview',
  results: 'Results',
  state: 'State',
  qasm: 'OpenQASM',
};

function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
}) {
  return (
    <div className="pk-seg" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`pk-seg-btn ${value === o.value ? 'is-on' : ''}`}
          aria-pressed={value === o.value}
          onClick={() => onChange(o.value)}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      className={`pk-toggle ${checked ? 'is-on' : ''}`}
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
    >
      <span className="pk-toggle-label">{label}</span>
      <span className="pk-toggle-track" aria-hidden="true">
        <span className="pk-toggle-thumb" />
      </span>
    </button>
  );
}

/**
 * Live list of the machine's cameras. Enumerates on mount (the drawer remounts
 * this each time it opens, so reopening after the first camera start picks up
 * the now-populated real labels) and follows `devicechange` — an iPhone joining
 * a Mac as a Continuity Camera, a USB webcam plugged in, etc.
 */
function useCameraDevices(): CameraDevice[] {
  const [devices, setDevices] = useState<CameraDevice[]>([]);
  useEffect(() => {
    let alive = true;
    const refresh = () => {
      void enumerateCameras().then((list) => {
        if (alive) setDevices(list);
      });
    };
    refresh();
    const unsub = subscribeDeviceChange(refresh);
    return () => {
      alive = false;
      unsub();
    };
  }, []);
  return devices;
}

/** CAMERA section — pick the capture device (Automatic, or a specific camera). */
function CameraSection() {
  const settings = useSettings();
  const devices = useCameraDevices();
  const options: Array<{ value: string | null; label: string }> = [
    { value: null, label: 'Automatic (rear)' },
    ...devices.map((d) => ({ value: d.deviceId, label: d.label })),
  ];
  return (
    <section className="pk-drawer-sec">
      <div className="pk-label">Camera</div>
      <div className="pk-radio" role="radiogroup" aria-label="Camera">
        {options.map((o) => {
          const selected = settings.cameraId === o.value;
          return (
            <button
              key={o.value ?? '__auto__'}
              type="button"
              className={`pk-radio-btn ${selected ? 'is-on' : ''}`}
              role="radio"
              aria-checked={selected}
              onClick={() => settingsStore.update({ cameraId: o.value })}
            >
              <span className="pk-radio-dot" aria-hidden="true" />
              <span className="pk-radio-label">{o.label}</span>
            </button>
          );
        })}
      </div>
      {hasOnlyPlaceholders(devices) && (
        <p className="pk-drawer-hint">Start the camera once to see camera names.</p>
      )}
    </section>
  );
}

/**
 * BOOTH section — the manual Display-role trigger (docs/pocket.md, "Booth").
 * Enter a booth host (`wss://host:8443` / `https://host:8443` / bare host);
 * Connect joins it as a read-only viewer. The URL persists in settings; the
 * served-by-host and `?connect=1` triggers live in App, not here. Connecting
 * NEVER sends any control message — the pocket viewer is view-only.
 */
function BoothSection() {
  const settings = useSettings();
  const link = useBoothLink();
  const connected = link.url !== null;
  const [draft, setDraft] = useState(settings.boothUrl ?? '');
  const valid = normalizeBoothUrl(draft) !== null;

  return (
    <section className="pk-drawer-sec">
      <div className="pk-label">Booth</div>
      {connected ? (
        <>
          <p className="pk-drawer-hint">Connected — viewing the booth (read-only).</p>
          <button type="button" className="pk-btn is-stop" onClick={() => boothLink.disconnect()}>
            Disconnect
          </button>
        </>
      ) : (
        <>
          <input
            className="pk-input"
            type="url"
            inputMode="url"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="wss://booth.local:8443"
            value={draft}
            aria-label="Booth host"
            onChange={(e) => setDraft(e.target.value)}
          />
          <button
            type="button"
            className="pk-btn"
            disabled={!valid}
            onClick={() => {
              settingsStore.update({ boothUrl: draft.trim() || null });
              boothLink.connect(draft);
            }}
          >
            Connect to booth
          </button>
          <p className="pk-drawer-hint">Follow a booth’s screen and take its circuit home.</p>
        </>
      )}
    </section>
  );
}

export function SettingsControl() {
  const settings = useSettings();
  const [open, setOpen] = useState(false);

  const close = useCallback(() => setOpen(false), []);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, close]);

  return (
    <>
      <button
        type="button"
        className="pk-gear"
        aria-label="Settings"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">
          <path
            fill="currentColor"
            d="M19.14 12.94a7.5 7.5 0 0 0 .05-1.88l2-1.56a.5.5 0 0 0 .12-.64l-1.9-3.29a.5.5 0 0 0-.6-.22l-2.36.95a7 7 0 0 0-1.62-.94l-.36-2.5A.5.5 0 0 0 13.5 2h-3a.5.5 0 0 0-.5.42l-.36 2.5c-.58.24-1.12.55-1.62.94l-2.36-.95a.5.5 0 0 0-.6.22L2.7 8.86a.5.5 0 0 0 .12.64l2 1.56a7.5 7.5 0 0 0 .05 1.88l-2 1.56a.5.5 0 0 0-.12.64l1.9 3.29a.5.5 0 0 0 .6.22l2.36-.95c.5.39 1.04.7 1.62.94l.36 2.5a.5.5 0 0 0 .5.42h3a.5.5 0 0 0 .5-.42l.36-2.5c.58-.24 1.12-.55 1.62-.94l2.36.95a.5.5 0 0 0 .6-.22l1.9-3.29a.5.5 0 0 0-.12-.64ZM12 15.5A3.5 3.5 0 1 1 12 8.5a3.5 3.5 0 0 1 0 7Z"
          />
        </svg>
      </button>

      {open && (
        <div className="pk-drawer-scrim" onClick={close}>
          <aside
            className="pk-drawer"
            role="dialog"
            aria-label="Settings"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pk-drawer-head">
              <span className="pk-drawer-title">Settings</span>
              <button type="button" className="pk-drawer-close" aria-label="Close" onClick={close}>
                ✕
              </button>
            </div>

            <div className="pk-drawer-body">
              <section className="pk-drawer-sec">
                <div className="pk-label">Mode</div>
                <Segmented<Mode>
                  value={settings.mode}
                  options={[
                    { value: 'composer', label: 'Composer' },
                    { value: 'golf', label: 'Quantum Golf' },
                  ]}
                  onChange={(mode) => settingsStore.update({ mode })}
                />
              </section>

              <section className="pk-drawer-sec">
                <div className="pk-label">Panels</div>
                {PANEL_IDS.map((p) => (
                  <Toggle
                    key={p}
                    label={PANEL_LABELS[p]}
                    checked={settings.panels.includes(p)}
                    onChange={() => settingsStore.togglePanel(p)}
                  />
                ))}
              </section>

              <section className="pk-drawer-sec">
                <div className="pk-label">Wires</div>
                <Segmented<Wires>
                  value={settings.wires}
                  options={[
                    { value: 'compact', label: 'auto' },
                    { value: 'all', label: 'all 5' },
                  ]}
                  onChange={(wires) => settingsStore.update({ wires })}
                />
              </section>

              <section className="pk-drawer-sec">
                <div className="pk-label">Sidebar side</div>
                <Segmented<Side>
                  value={settings.side}
                  options={[
                    { value: 'left', label: 'Left' },
                    { value: 'right', label: 'Right' },
                  ]}
                  onChange={(side) => settingsStore.update({ side })}
                />
              </section>

              <CameraSection />

              <BoothSection />

              <section className="pk-drawer-sec">
                <div className="pk-label">Power</div>
                <Toggle
                  label="Low-power mode"
                  checked={settings.lowpower}
                  onChange={(lowpower) => settingsStore.update({ lowpower })}
                />
              </section>

              <section className="pk-drawer-sec">
                <div className="pk-label">Developer</div>
                <Toggle
                  label="Debug panel"
                  checked={settings.debug}
                  onChange={(debug) => settingsStore.update({ debug })}
                />
              </section>

              <section className="pk-drawer-sec">
                <a className="pk-drawer-row" href="#guide" onClick={close}>
                  <span>Guide &amp; about</span>
                  <span aria-hidden="true" className="pk-drawer-row-chevron">
                    →
                  </span>
                </a>
              </section>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

export default SettingsControl;
