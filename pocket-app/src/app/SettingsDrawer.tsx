/**
 * Settings drawer (docs/pocket.md) — a gear pill in the topbar opens a
 * right-side overlay (pk styling, hairline border, 200 ms slide-in, ESC /
 * backdrop close). All touch targets ≥ 44 px. Changes go straight through the
 * settings store (which persists and clears the matching URL override).
 *
 * Two groups, because a visitor who opens the gear should meet the settings a
 * visitor uses — not the booth's wiring:
 *   - VISITOR (always visible): language (English · Deutsch), mode (+ golf
 *     course code / Quantina menu), input, panels, wires, noise, camera,
 *     low-power, and the guide link.
 *   - STAFF & ADVANCED (collapsed at the bottom): board layout, sidebar side,
 *     the booth host / camera role, and the debug panel. Collapsed by default;
 *     its open state is remembered for the page session only (module memory,
 *     nothing stored), so a staffer re-opening the drawer finds it as they left
 *     it, and the next visitor after a reload finds it closed.
 * The grouping is presentational only: every setting keeps its storage key,
 * URL override and behaviour.
 */
import { useCallback, useEffect, useState, type ReactNode } from 'react';
import {
  PANEL_IDS,
  settingsStore,
  useSettings,
  type BoardLayout,
  type InputMode,
  type Mode,
  type NoisePreset,
  type Side,
  type Wires,
} from './settings';
import {
  enumerateCameras,
  hasOnlyPlaceholders,
  subscribeDeviceChange,
  type CameraDevice,
} from './cameraDevices';
import { BUILTIN_PACKS } from '@shared/menu/builtinPacks';
import { boothLink, useBoothLink } from './boothLink';
import { cameraRoleLink, useCameraRole } from './cameraRoleLink';
import { normalizeBoothUrl } from '../sources/boothUrl';
import { courseCode, parseCourseCode } from '@quantum/golfRandom';
import { LANGS, LANGUAGE_LABEL, LANG_NAMES, useLang, useT, type Lang } from '@shared/i18n';

/** One glyph per built-in menu pack for the drawer's Menu picker. */
const MENU_EMOJI: Record<string, string> = {
  coffee: '☕',
  cocktails: '🍸',
  icecream: '🍨',
  juice: '🧃',
  demo: '🍕',
};

/**
 * Golf course code (#78). A random course is fully determined by its seed, so
 * the code IS the course: typing one a friend read out deals the identical
 * eighteen holes. Empty means the classic course; an unparseable code is
 * refused rather than silently dealing a different round.
 */
function GolfCourseSection() {
  const settings = useSettings();
  const t = useT().settings;
  const [draft, setDraft] = useState(settings.courseCode ?? '');
  const trimmed = draft.trim();
  const valid = trimmed === '' || parseCourseCode(trimmed) !== null;

  // The card, the URL and "New random 18" all write this setting, so the field
  // follows whatever the app is actually playing.
  useEffect(() => setDraft(settings.courseCode ?? ''), [settings.courseCode]);

  const apply = () => {
    if (trimmed === '') {
      settingsStore.update({ courseCode: null });
      return;
    }
    const seed = parseCourseCode(trimmed);
    if (seed !== null) settingsStore.update({ courseCode: courseCode(seed) });
  };

  return (
    <section className="pk-drawer-sec">
      <div className="pk-label">{t.golfCode}</div>
      <input
        className={`pk-input${valid ? '' : ' is-invalid'}`}
        type="text"
        inputMode="text"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        placeholder={t.golfCodePlaceholder}
        aria-label={t.golfCode}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === 'Enter') apply();
        }}
      />
      <p className="pk-drawer-hint">
        {settings.courseCode ? t.golfCodeShared : t.golfCodeHint}
      </p>
    </section>
  );
}

function Segmented<T extends string>({
  value,
  options,
  onChange,
  disabled = false,
}: {
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (v: T) => void;
  /** Locked out — used when a connected booth owns the setting. */
  disabled?: boolean;
}) {
  return (
    <div className="pk-seg" role="group">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          className={`pk-seg-btn ${value === o.value ? 'is-on' : ''}`}
          aria-pressed={value === o.value}
          disabled={disabled}
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
  disabled = false,
}: {
  label: string;
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      className={`pk-toggle ${checked ? 'is-on' : ''}`}
      role="switch"
      aria-checked={checked}
      disabled={disabled}
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
  const t = useT().settings;
  const devices = useCameraDevices();
  // A placeholder ("Camera 2", before permission) is re-worded by its position.
  const options: Array<{ value: string | null; label: string }> = [
    { value: null, label: t.cameraAuto },
    ...devices.map((d, i) => ({
      value: d.deviceId,
      label: d.placeholder ? t.cameraPlaceholder(i + 1) : d.label,
    })),
  ];
  return (
    <section className="pk-drawer-sec">
      <div className="pk-label">{t.camera}</div>
      <div className="pk-radio" role="radiogroup" aria-label={t.camera}>
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
        <p className="pk-drawer-hint">{t.cameraNamesHint}</p>
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
function BoothSection({
  cameraRoleAvailable = false,
  onClose,
}: {
  /** Offer the staff CAMERA role here (host known + operator key present). */
  cameraRoleAvailable?: boolean;
  onClose: () => void;
}) {
  const settings = useSettings();
  const link = useBoothLink();
  const cameraRole = useCameraRole();
  const t = useT().settings;
  const connected = link.url !== null;
  const [draft, setDraft] = useState(settings.boothUrl ?? '');
  const valid = normalizeBoothUrl(draft) !== null;

  // Already streaming as the booth's camera → offer only an exit.
  if (cameraRole.active) {
    return (
      <section className="pk-drawer-sec">
        <div className="pk-label">{t.booth}</div>
        <p className="pk-drawer-hint">{t.boothIsCamera}</p>
        <button
          type="button"
          className="pk-btn is-stop"
          onClick={() => {
            cameraRoleLink.exit();
            onClose();
          }}
        >
          {t.stopBeingCamera}
        </button>
      </section>
    );
  }

  return (
    <section className="pk-drawer-sec">
      <div className="pk-label">{t.booth}</div>
      {connected ? (
        <>
          <p className="pk-drawer-hint">{t.boothConnected}</p>
          <button type="button" className="pk-btn is-stop" onClick={() => boothLink.disconnect()}>
            {t.disconnect}
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
            aria-label={t.boothHost}
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
            {t.connect}
          </button>
          <p className="pk-drawer-hint">{t.boothHint}</p>
          {/* Staff CAMERA role (U2): operator-gated — shown only when a host is
              known AND an operator key is present. A visitor never sees this. */}
          {cameraRoleAvailable && (
            <>
              <button
                type="button"
                className="pk-btn"
                onClick={() => {
                  const stateUrl = settings.boothUrl ? normalizeBoothUrl(settings.boothUrl) : null;
                  cameraRoleLink.enter(stateUrl);
                  onClose();
                }}
              >
                {t.useAsCamera}
              </button>
              <p className="pk-drawer-hint">{t.useAsCameraHint}</p>
            </>
          )}
        </>
      )}
    </section>
  );
}

/**
 * LANGUAGE — English · Deutsch. First in the visitor group, and labelled in
 * both languages, so someone who reads only one of them still finds it. The
 * choice is stored (`entangible.lang`) and wins over the browser's language;
 * a `?lang=` link still wins over it on the page it opens (see shared/i18n).
 */
function LanguageSection() {
  const { lang, setLang } = useLang();
  return (
    <section className="pk-drawer-sec">
      <div className="pk-label">{LANGUAGE_LABEL}</div>
      <Segmented<Lang>
        value={lang}
        options={LANGS.map((l) => ({ value: l, label: LANG_NAMES[l] }))}
        onChange={setLang}
      />
    </section>
  );
}

/**
 * Is the Staff & advanced group open? Page-session memory: survives the drawer
 * closing and re-opening (the drawer body unmounts each time), resets on a
 * reload, and is never persisted — the next visitor always starts collapsed.
 */
let advancedOpen = false;

/** Test seam: collapse the Staff & advanced group (the page-session default). */
export function resetAdvancedOpen(): void {
  advancedOpen = false;
}

/**
 * The collapsed-by-default "Staff & advanced" group — a disclosure (the
 * `<details>` pattern as a button + region, so collapsed content is genuinely
 * absent rather than merely hidden).
 */
function AdvancedGroup({ children }: { children: ReactNode }) {
  const label = useT().settings.advanced;
  const [open, setOpen] = useState(advancedOpen);
  const toggle = () => {
    advancedOpen = !open;
    setOpen(!open);
  };
  return (
    <section className={`pk-drawer-sec pk-drawer-adv${open ? ' is-open' : ''}`}>
      <button
        type="button"
        className="pk-drawer-adv-toggle"
        aria-expanded={open}
        aria-controls="pk-drawer-adv-body"
        onClick={toggle}
      >
        <span>{label}</span>
        <span aria-hidden="true" className="pk-drawer-adv-chevron">
          ▸
        </span>
      </button>
      {open && (
        <div
          id="pk-drawer-adv-body"
          className="pk-drawer-adv-body"
          role="region"
          aria-label={label}
        >
          {children}
        </div>
      )}
    </section>
  );
}

export function SettingsControl({
  cameraRoleAvailable = false,
}: {
  /** Offer the staff CAMERA role in the Booth section (host known + key present). */
  cameraRoleAvailable?: boolean;
} = {}) {
  const settings = useSettings();
  // Connected as a booth viewer → the booth drives the panel set (an overlay on
  // the local settings), so the PANELS section is shown read-only.
  const connected = useBoothLink().url !== null;
  const [open, setOpen] = useState(false);
  const t = useT().settings;

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
        aria-label={t.title}
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
            aria-label={t.title}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pk-drawer-head">
              <span className="pk-drawer-title">{t.title}</span>
              <button type="button" className="pk-drawer-close" aria-label={t.close} onClick={close}>
                ✕
              </button>
            </div>

            <div className="pk-drawer-body">
              <LanguageSection />

              <section className="pk-drawer-sec">
                <div className="pk-label">{t.mode}</div>
                <Segmented<Mode>
                  value={settings.mode}
                  options={[
                    { value: 'composer', label: t.modes.composer },
                    { value: 'golf', label: t.modes.golf },
                    { value: 'quantina', label: t.modes.quantina },
                    { value: 'runner', label: t.modes.runner },
                  ]}
                  onChange={(mode) => settingsStore.update({ mode })}
                />
              </section>

              {settings.mode === 'golf' && <GolfCourseSection />}

              {settings.mode === 'quantina' && (
                <section className="pk-drawer-sec">
                  <div className="pk-label">{t.menu}</div>
                  <Segmented<string>
                    value={settings.menu}
                    options={BUILTIN_PACKS.map((p) => ({
                      value: p.id,
                      label: `${MENU_EMOJI[p.id] ?? '🍽️'} ${p.title}`,
                    }))}
                    onChange={(menu) => settingsStore.update({ menu })}
                  />
                  <p className="pk-drawer-hint">{t.menuHint}</p>
                </section>
              )}

              <section className="pk-drawer-sec">
                <div className="pk-label">{t.input}</div>
                <Segmented<InputMode>
                  value={settings.input}
                  options={[
                    { value: 'camera', label: t.inputCamera },
                    { value: 'manual', label: t.inputManual },
                  ]}
                  onChange={(input) => settingsStore.update({ input })}
                />
                <p className="pk-drawer-hint">{t.inputHint}</p>
              </section>

              <section className="pk-drawer-sec">
                <div className="pk-label">{t.panels}</div>
                {PANEL_IDS.map((p) => (
                  <Toggle
                    key={p}
                    label={t.panelLabels[p]}
                    checked={settings.panels.includes(p)}
                    disabled={connected}
                    onChange={() => settingsStore.togglePanel(p)}
                  />
                ))}
                {connected && <p className="pk-drawer-hint">{t.controlledByBooth}</p>}
              </section>

              <section className="pk-drawer-sec">
                <div className="pk-label">{t.wires}</div>
                <Segmented<Wires>
                  value={settings.wires}
                  options={[
                    { value: 'compact', label: t.wiresAuto },
                    { value: 'all', label: t.wiresAll },
                  ]}
                  onChange={(wires) => settingsStore.update({ wires })}
                />
              </section>

              <section className="pk-drawer-sec">
                <div className="pk-label">{t.noise}</div>
                <Segmented<NoisePreset>
                  value={settings.noise}
                  options={[
                    { value: 'off', label: t.noiseOptions.off },
                    { value: 'falcon', label: t.noiseOptions.falcon },
                    { value: 'eagle', label: t.noiseOptions.eagle },
                    { value: 'heron', label: t.noiseOptions.heron },
                    { value: 'nighthawk', label: t.noiseOptions.nighthawk },
                  ]}
                  onChange={(noise) => settingsStore.update({ noise })}
                />
                <p className="pk-drawer-hint">{t.noiseHint}</p>
              </section>

              <CameraSection />

              <section className="pk-drawer-sec">
                <div className="pk-label">{t.power}</div>
                <Toggle
                  label={t.lowPower}
                  checked={settings.lowpower}
                  onChange={(lowpower) => settingsStore.update({ lowpower })}
                />
              </section>

              <section className="pk-drawer-sec">
                <a className="pk-drawer-row" href="#guide" onClick={close}>
                  <span>{t.guide}</span>
                  <span aria-hidden="true" className="pk-drawer-row-chevron">
                    →
                  </span>
                </a>
              </section>

              {/* Operator-ish settings: how the table is read, where the
                  sidebar sits, the booth link / staff camera role, debugging. */}
              <AdvancedGroup>
                <section className="pk-drawer-sec">
                  <div className="pk-label">{t.board}</div>
                  <Segmented<BoardLayout>
                    value={settings.boardLayout}
                    options={[
                      { value: 'grid', label: t.boardGrid },
                      { value: 'stretch', label: t.boardStretch },
                    ]}
                    disabled={connected}
                    onChange={(boardLayout) => settingsStore.update({ boardLayout })}
                  />
                  <p className="pk-drawer-hint">
                    {t.boardHint} {connected ? t.controlledByBooth : null}
                  </p>
                </section>

                <section className="pk-drawer-sec">
                  <div className="pk-label">{t.sidebarSide}</div>
                  <Segmented<Side>
                    value={settings.side}
                    options={[
                      { value: 'left', label: t.left },
                      { value: 'right', label: t.right },
                    ]}
                    onChange={(side) => settingsStore.update({ side })}
                  />
                </section>

                <BoothSection cameraRoleAvailable={cameraRoleAvailable} onClose={close} />

                <section className="pk-drawer-sec">
                  <div className="pk-label">{t.developer}</div>
                  <Toggle
                    label={t.debugPanel}
                    checked={settings.debug}
                    onChange={(debug) => settingsStore.update({ debug })}
                  />
                </section>
              </AdvancedGroup>
            </div>
          </aside>
        </div>
      )}
    </>
  );
}

export default SettingsControl;
