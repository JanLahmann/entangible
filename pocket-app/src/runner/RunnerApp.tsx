/**
 * Quantum Runner — the runner-only app shell (docs/runner-bundle.md).
 *
 * Built as its own bundle (`npm run build:runner` → dist-runner/) that the Fun
 * with Quantum iOS app embeds offline. It plays the SAME game as the site's
 * runner mode — `RunnerGame` (shared with App) over the pure engine
 * `@quantum/runner` — under a slim toolbar instead of the site header: the 1/2
 * qubit choice, EN/DE and How to play. Everything else the site carries is
 * absent from this module graph, not hidden: no camera, vision, composer / QR,
 * Quantina, golf, editor library, kiosk, debug, guide, booth socket, analytics
 * module or service worker (scripts/check-bundle.mjs --bundle runner guards
 * it). Game events go to the host's injected bridge only (`hostTrack`,
 * src/bundle/hostEvents.ts).
 *
 * Every run waits for Start (+ a 3-2-1 countdown): the app may open the page
 * long before the player looks at it, and a VoiceOver user needs the moment to
 * find the gates. The rules sheet holds the run while it is open.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { Level } from '@quantum/runner';
import { useLang, useT } from '@shared/i18n';
import { RunnerGame } from '../app/RunnerGame';
import { defaultRunnerStorage, type KeyStorage } from '../app/runnerBest';
import { hostTrack } from '../bundle/hostEvents';

/** The "more" link in the rules: the public site (opened by the host in Safari). */
export const SITE_URL = 'https://entangible.org/';

/** The bundle's last 1/2-qubit choice (bundle only — the site keeps none). */
export const RUNNER_LEVEL_KEY = 'entangible.runner.level';

export function loadLevel(storage: KeyStorage | null): Level {
  try {
    return storage?.getItem(RUNNER_LEVEL_KEY) === '2' ? 2 : 1;
  } catch {
    return 1;
  }
}

function saveLevel(storage: KeyStorage | null, level: Level): void {
  try {
    storage?.setItem(RUNNER_LEVEL_KEY, String(level));
  } catch {
    /* storage full / blocked: the choice holds for this page only */
  }
}

export function RunnerApp({ autoRun = true }: { autoRun?: boolean } = {}) {
  const t = useT();
  const r = t.runnerApp;
  const storage = useMemo(defaultRunnerStorage, []);
  const [level, setLevel] = useState<Level>(() => loadLevel(storage));
  const [rules, setRules] = useState(false);

  const pick = (lv: Level) => {
    setLevel(lv);
    saveLevel(storage, lv);
  };

  return (
    <div className="pk-runnerapp">
      <nav className="pk-runnerbar" aria-label={r.toolbarAria}>
        <div className="pk-runnerbar-qubits" role="group" aria-label={r.qubitsAria}>
          {([1, 2] as Level[]).map((lv) => (
            <button
              key={lv}
              type="button"
              className="pk-runnerbar-btn pk-runnerbar-qubit"
              aria-pressed={level === lv}
              onClick={() => pick(lv)}
            >
              {lv === 1 ? t.runner.oneQubit : t.runner.twoQubits}
            </button>
          ))}
        </div>
        <span className="pk-runnerbar-spacer" />
        <LanguageToggle />
        <button
          type="button"
          className="pk-runnerbar-btn"
          aria-haspopup="dialog"
          aria-expanded={rules}
          onClick={() => setRules((v) => !v)}
        >
          {r.rulesButton}
        </button>
      </nav>

      <main className="pk-runnerapp-main">
        <RunnerGame
          autoRun={autoRun}
          level={level}
          initialLevel={level}
          showLevelPicker={false}
          startPaused
          suspended={rules}
          storage={storage}
          onEvent={hostTrack}
        />
      </main>

      {rules && <RulesSheet onClose={() => setRules(false)} />}
    </div>
  );
}

/** EN ⇄ DE. The choice is stored like the site's (`entangible.lang`). */
function LanguageToggle() {
  const { lang, setLang } = useLang();
  const r = useT().runnerApp;
  return (
    <button
      type="button"
      className="pk-runnerbar-btn pk-runnerbar-lang"
      aria-label={r.languageAria}
      onClick={() => setLang(lang === 'de' ? 'en' : 'de')}
    >
      {lang === 'de' ? 'EN' : 'DE'}
    </button>
  );
}

/** The rules: a modal sheet (scrim click, ✕ and Escape close it). */
function RulesSheet({ onClose }: { onClose: () => void }) {
  const r = useT().runnerApp;
  const close = useCallback(() => onClose(), [onClose]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [close]);
  return (
    <div className="pk-runnersheet-scrim" onClick={close}>
      <div
        className="pk-runnersheet"
        role="dialog"
        aria-modal="true"
        aria-label={r.rulesTitle}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pk-runnersheet-head">
          <h2 className="pk-runnersheet-title">{r.rulesTitle}</h2>
          <button type="button" className="pk-runnersheet-close" aria-label={r.close} onClick={close}>
            ✕
          </button>
        </div>
        <div className="pk-runnersheet-body">
          {r.rules.map((p, i) => (
            <p key={i} className="pk-runnersheet-p">
              {p}
            </p>
          ))}
          <p className="pk-runnersheet-credit">{r.credit}</p>
          <p className="pk-runnersheet-muted">
            {r.moreLead}{' '}
            <a href={SITE_URL} target="_blank" rel="noopener noreferrer">
              entangible.org
            </a>
          </p>
        </div>
      </div>
    </div>
  );
}

export default RunnerApp;
