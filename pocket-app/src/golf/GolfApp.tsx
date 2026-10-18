/**
 * Quantum Golf — the golf-only app shell (docs/golf-bundle.md).
 *
 * Built as its own bundle (`npm run build:golf` → dist-golf/) that the Fun with
 * Quantum iOS app embeds offline. It plays the SAME game as the site's golf
 * mode — `useGolfGame` drives it and `GolfBoard` draws it, both shared with
 * `App` — with the on-screen editor as the only input. Everything else the
 * site carries is absent from this module graph, not hidden: no camera,
 * vision, booth socket, composer hand-off, QR, Quantina, Runner, kiosk,
 * debug, guide, settings drawer, analytics or service worker
 * (scripts/check-golf-bundle.mjs guards it).
 *
 * Layout: the pocket stylesheet's own golf + build-on-screen grid (stage with
 * palette + editor, sidebar with sphere / course / scorecard) under a slim
 * toolbar instead of the site header — the host app's title bar already names
 * the game. golf.css adds the touch / safe-area / hover policy on top.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import {
  ThemeProvider,
  QamposerProvider,
  CircuitEditor,
  Operations,
  createDefaultCircuit,
  type Circuit,
} from '@qamposer/react';
import { useLang, useT } from '@shared/i18n';
import { displayCircuit } from '@shared/display/displayWires';
import { clubGateTypes } from '@quantum/golf';
import { courseCode as toCourseCode } from '@quantum/golfRandom';
import { ManualEditSource, BOARD_QUBITS } from '../sources/ManualEditSource';
import type { StateUpdate } from '../sources/StateSource';
import { Celebrations, type CelebrationRequest } from '../app/Celebrations';
import { GolfBoard } from '../app/GolfBoard';
import { useGolfGame } from '../app/useGolfGame';
import { editorScaleStyle, useEditorFit } from '../app/useEditorFit';
import { mainClassName, stageClassName } from '../app/layoutClasses';
import { cleanCode, loadCourse, saveCourse, type CourseChoice } from './courseStore';

/** Where a copied course link (and the "more" link) points: the public site. */
export const SITE_URL = 'https://entangible.org/';

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

type Panel = 'course' | 'rules' | null;

export function GolfApp() {
  const t = useT();
  const g = t.golfApp;
  const storage = useMemo(safeStorage, []);
  const [choice, setChoice] = useState<CourseChoice>(() =>
    loadCourse(storage, typeof window === 'undefined' ? '' : window.location.search),
  );
  const updateChoice = useCallback(
    (patch: Partial<CourseChoice>) =>
      setChoice((prev) => {
        const next = { ...prev, ...patch };
        saveCourse(storage, next);
        return next;
      }),
    [storage],
  );

  const [circuit, setCircuit] = useState<Circuit>(() => createDefaultCircuit(BOARD_QUBITS));
  const [celebration, setCelebration] = useState<CelebrationRequest | null>(null);
  const tokenRef = useRef(0);
  // The on-screen editor is the only input: held for the session, fed by the
  // editor's own edits, deduped structurally (no feedback loop).
  const sourceRef = useRef<ManualEditSource>(new ManualEditSource());

  const golf = useGolfGame({
    storage,
    courseCode: choice.courseCode,
    courseScope: choice.courseScope,
    setCourseCode: (courseCode) => updateChoice({ courseCode }),
    setCourseScope: (courseScope) => updateChoice({ courseScope }),
    clearBoard: () => sourceRef.current.clear(),
    circuit,
    onCelebrate: (c) => setCelebration({ ...c, token: ++tokenRef.current }),
  });
  const golfStep = golf.step;

  // The same "circuit changed → engine" path as the site's applyUpdate, golf
  // branch only (by circuit identity, so a re-emit of the same one is a no-op).
  const appliedRef = useRef<Circuit | null>(null);
  useEffect(() => {
    const source = sourceRef.current;
    appliedRef.current = null;
    const unsub = source.subscribe((update: StateUpdate) => {
      if (update.circuit === appliedRef.current) return;
      appliedRef.current = update.circuit;
      setCircuit(update.circuit);
      golfStep(update.circuit);
    });
    source.start();
    return () => {
      unsub();
      source.stop();
    };
  }, [golfStep]);

  const onEditorChange = useCallback((next: Circuit) => {
    sourceRef.current.setFromEditor(next);
  }, []);

  const level = golf.currentLevel;
  // The board shows exactly the hole's wires and grows with use (#67).
  const displayed = useMemo(
    () => displayCircuit(circuit, 'compact', level.qubits),
    [circuit, level.qubits],
  );
  // Golf hands out clubs, not the whole bag (#55).
  const paletteGates = useMemo(() => clubGateTypes(level), [level]);
  const { containerRef, fit } = useEditorFit(displayed.qubits);
  const qamposerConfig = useMemo(() => ({ maxQubits: BOARD_QUBITS }), []);

  const [panel, setPanel] = useState<Panel>(null);

  return (
    <div className="pk pk--golf">
      <nav className="pk-golfbar" aria-label={g.toolbarAria}>
        <button
          type="button"
          className="pk-golfbar-btn"
          aria-haspopup="dialog"
          aria-expanded={panel === 'course'}
          onClick={() => setPanel(panel === 'course' ? null : 'course')}
        >
          {g.courseButton}
          <span className="pk-golfbar-now">
            {golf.state.course === 'random'
              ? `#${toCourseCode(golf.state.randomSeed)}`
              : t.golf.classic18}
          </span>
        </button>
        <span className="pk-spacer" />
        <LanguageToggle />
        <button
          type="button"
          className="pk-golfbar-btn"
          aria-haspopup="dialog"
          aria-expanded={panel === 'rules'}
          onClick={() => setPanel(panel === 'rules' ? null : 'rules')}
        >
          {g.rulesButton}
        </button>
      </nav>

      <ThemeProvider defaultTheme="dark">
        <QamposerProvider circuit={displayed} config={qamposerConfig} onCircuitChange={onEditorChange}>
          <main className={mainClassName(false, true)}>
            <section className={stageClassName(true)}>
              <div className="pk-manual-palette">
                <Operations gateTypes={paletteGates} />
              </div>
              <div
                className={`pk-stage-editor ${fit.scroll ? 'is-scroll' : ''}`}
                ref={containerRef}
              >
                <div className="pk-editor-scale" style={editorScaleStyle(fit)}>
                  <CircuitEditor />
                </div>
              </div>
            </section>
            <aside className="pk-side">
              <GolfBoard game={golf} circuit={circuit} shareBase={SITE_URL} />
            </aside>
          </main>
        </QamposerProvider>
      </ThemeProvider>

      <Celebrations celebration={celebration} />

      {panel === 'course' && (
        <CoursePanel
          game={golf}
          onEnterCode={(code) => updateChoice({ courseCode: code })}
          onClose={() => setPanel(null)}
        />
      )}
      {panel === 'rules' && <RulesPanel onClose={() => setPanel(null)} />}
    </div>
  );
}

/** EN ⇄ DE. The choice is stored like the site's (`entangible.lang`). */
function LanguageToggle() {
  const { lang, setLang } = useLang();
  const g = useT().golfApp;
  return (
    <button
      type="button"
      className="pk-golfbar-btn pk-golfbar-lang"
      aria-label={g.languageAria}
      onClick={() => setLang(lang === 'de' ? 'en' : 'de')}
    >
      {lang === 'de' ? 'EN' : 'DE'}
    </button>
  );
}

/** A modal sheet: scrim click, ✕ and Escape close it. */
function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  const g = useT().golfApp;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="pk-golfsheet-scrim" onClick={onClose}>
      <div
        className="pk-golfsheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="pk-golfsheet-head">
          <h2 className="pk-golfsheet-title">{title}</h2>
          <button type="button" className="pk-golfsheet-close" aria-label={g.close} onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="pk-golfsheet-body">{children}</div>
      </div>
    </div>
  );
}

/** Pick / restart a course, or play one by its code. */
function CoursePanel({
  game,
  onEnterCode,
  onClose,
}: {
  game: ReturnType<typeof useGolfGame>;
  onEnterCode: (code: string) => void;
  onClose: () => void;
}) {
  const t = useT();
  const g = t.golfApp;
  const [text, setText] = useState('');
  const [bad, setBad] = useState(false);
  const { state } = game;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const code = cleanCode(text);
    if (code === null) {
      setBad(true);
      return;
    }
    onEnterCode(code);
    onClose();
  };

  return (
    <Sheet title={g.courseTitle} onClose={onClose}>
      <p className="pk-golfsheet-now">
        {state.course === 'random' ? g.nowRandom(toCourseCode(state.randomSeed)) : g.nowClassic}
      </p>
      <div className="pk-golfsheet-actions">
        <button
          type="button"
          className="pk-golfsheet-btn"
          onClick={() => {
            game.pickCourse('classic');
            onClose();
          }}
        >
          {t.golf.classic18}
        </button>
        <button
          type="button"
          className="pk-golfsheet-btn"
          onClick={() => {
            game.pickCourse('random');
            onClose();
          }}
        >
          {t.golf.newRandom18}
        </button>
        <button
          type="button"
          className="pk-golfsheet-btn pk-golfsheet-btn--quiet"
          onClick={() => {
            // A re-tee of the same course and scope — the scope pick does
            // exactly that (bests on the classic card are kept).
            game.pickScope(state.scope);
            onClose();
          }}
        >
          {g.restart}
        </button>
      </div>
      <form className="pk-golfsheet-code" onSubmit={submit} noValidate>
        <label className="pk-label" htmlFor="pk-golf-code">
          {g.enterCode}
        </label>
        <div className="pk-golfsheet-code-row">
          <input
            id="pk-golf-code"
            className="pk-golfsheet-input"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setBad(false);
            }}
            placeholder={g.codePlaceholder}
            autoCapitalize="none"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
            inputMode="text"
            maxLength={8}
            aria-invalid={bad}
          />
          <button type="submit" className="pk-golfsheet-btn">
            {g.playCode}
          </button>
        </div>
        {bad && (
          <p className="pk-golfsheet-error" role="alert">
            {g.badCode}
          </p>
        )}
      </form>
      <p className="pk-golfsheet-muted">{g.courseIntro}</p>
    </Sheet>
  );
}

/** The rules, short — the long version is the site's guide. */
function RulesPanel({ onClose }: { onClose: () => void }) {
  const g = useT().golfApp;
  return (
    <Sheet title={g.rulesTitle} onClose={onClose}>
      {g.rules.map((p, i) => (
        <p key={i} className="pk-golfsheet-p">
          {p}
        </p>
      ))}
      <p className="pk-golfsheet-muted">
        {g.moreLead}{' '}
        <a href={SITE_URL} target="_blank" rel="noopener noreferrer">
          entangible.org
        </a>
      </p>
    </Sheet>
  );
}

export default GolfApp;
