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
} from './settings';

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
                    { value: 'golf', label: 'Golf' },
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
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

export default SettingsControl;
