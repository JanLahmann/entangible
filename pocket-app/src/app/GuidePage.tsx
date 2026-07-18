/**
 * Guide & about — the page that makes the public pocket app a self-contained
 * ambassador for Entangible (docs/pocket.md). Reachable at `#guide` before the
 * camera even starts; rendered as an overlay over the still-mounted app so an
 * active camera stream is never torn down (see App.tsx / hashNav.ts).
 *
 * Sections: what it is · how to use it · on-screen test boards (tap → fullscreen
 * viewer) · download the printable kit · the full project + links · footer.
 * Styling is pk-token, dark, restrained; the copy voice is plain and warm.
 */
import { useCallback, useEffect, useReducer, useRef } from 'react';
import { goBack, type NavWindow } from './hashNav';
import { TEST_BOARDS } from './testBoards';
import { reduceViewer, CLOSED, type ViewerAction } from './viewer';
import kitPdf from '../../../examples/print/entangible-print-kit-A4.pdf?url';
import tiles3d from '../../../examples/hardware/entangible-3d-tiles.zip?url';

const REPO_URL = 'https://github.com/JanLahmann/entangible';
const ISSUES_URL = 'https://github.com/JanLahmann/entangible/issues';
const QAMPOSER_URL = 'https://qamposer.org';
const RASQBERRY_URL = 'https://rasqberry.org';

function Label({ children }: { children: React.ReactNode }) {
  return <div className="pk-label pk-guide-label">{children}</div>;
}

export function GuidePage() {
  const onBack = useCallback(() => {
    if (typeof window !== 'undefined') goBack(window as unknown as NavWindow);
  }, []);

  // Fullscreen test-board viewer state machine (pure reducer + count).
  const [viewer, dispatch] = useReducer(
    (s: typeof CLOSED, a: ViewerAction) => reduceViewer(s, a, TEST_BOARDS.length),
    CLOSED,
  );
  const stageRef = useRef<HTMLDivElement>(null);

  // Enter/leave true fullscreen where available (else the fixed overlay alone
  // covers the screen). Keep viewer state in sync if the user exits native
  // fullscreen with the browser's own ESC.
  useEffect(() => {
    const el = stageRef.current;
    if (viewer.open) {
      if (el && el.requestFullscreen && !document.fullscreenElement) {
        el.requestFullscreen().catch(() => {});
      }
    } else if (document.fullscreenElement) {
      document.exitFullscreen().catch(() => {});
    }
  }, [viewer.open]);

  useEffect(() => {
    if (!viewer.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight') dispatch({ type: 'next' });
      else if (e.key === 'ArrowLeft') dispatch({ type: 'prev' });
      else if (e.key === 'Escape') dispatch({ type: 'close' });
    };
    const onFsChange = () => {
      if (!document.fullscreenElement) dispatch({ type: 'close' });
    };
    window.addEventListener('keydown', onKey);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => {
      window.removeEventListener('keydown', onKey);
      document.removeEventListener('fullscreenchange', onFsChange);
    };
  }, [viewer.open]);

  const board = TEST_BOARDS[viewer.index];

  return (
    <div className="pk-guide" role="region" aria-label="Guide and about">
      <header className="pk-guide-top">
        <button type="button" className="pk-pill pk-guide-back" onClick={onBack}>
          <span aria-hidden="true">←</span> Back
        </button>
        <div className="pk-brand">
          <span className="en">En</span>tangible<small>guide</small>
        </div>
      </header>

      <div className="pk-guide-body">
        {/* 1. What is this */}
        <section className="pk-guide-sec">
          <Label>What is this</Label>
          <p>
            Entangible is a quantum circuit composer you operate with your hands: physical gate
            tiles on a printed board, read by a camera, simulated live. This pocket app is the
            zero-install edition — everything runs right here in your browser; no server, no
            account, nothing leaves your device. Entangible is part of the QAMPoser open-source
            family.
          </p>
          <p className="pk-guide-muted">
            The name is a pun: <b>entangled + tangible = Entangible.</b>
          </p>
        </section>

        {/* 2. How to use it */}
        <section className="pk-guide-sec">
          <Label>How to use it</Label>
          <ol className="pk-guide-steps">
            <li>Print the kit (or use the on-screen boards below).</li>
            <li>
              Start the camera and point it at the board from 30–60 cm, with all four corner
              markers in view.
            </li>
            <li>
              Place tiles — the circuit, outcomes and QASM follow live. A <b>●</b> and a{' '}
              <b>⊕</b> in one column make a CNOT.
            </li>
            <li>Build a Bell pair for a surprise.</li>
          </ol>
          <p className="pk-guide-muted pk-guide-tips">
            Tips: pinch to zoom; the gear opens settings, including golf mode and a debug view;
            matte print beats glossy; screens work as boards (below).
          </p>
        </section>

        {/* 3. Test without a printer */}
        <section className="pk-guide-sec">
          <Label>Test without a printer</Label>
          <div className="pk-guide-grid">
            {TEST_BOARDS.map((b, i) => (
              <button
                key={b.id}
                type="button"
                className="pk-guide-card"
                onClick={() => dispatch({ type: 'open', index: i })}
              >
                <img src={b.src} alt={b.title} loading="lazy" />
                <span className="pk-guide-card-title">{b.title}</span>
                <span className="pk-guide-card-blurb">{b.blurb}</span>
              </button>
            ))}
          </div>
          <p className="pk-guide-muted">
            Show these fullscreen on one device, point another device's camera at it. Flip images
            to "move" tiles.
          </p>
        </section>

        {/* 4. Print the real kit */}
        <section className="pk-guide-sec">
          <Label>Print the real kit</Label>
          <p>
            One PDF, 13 × A4: 44 gate tiles + the board mat. Print at 100 % — never "fit to page" —
            on matte paper; each sheet carries a 100 mm check ruler.
          </p>
          <a
            className="pk-guide-download"
            href={kitPdf}
            download="entangible-print-kit-A4.pdf"
            target="_blank"
            rel="noopener noreferrer"
          >
            Download the print kit (PDF)
          </a>
          <p className="pk-guide-muted">
            An A1 single-sheet board for print shops lives in the repository.
          </p>
        </section>

        {/* 4b. 3D-print the tiles */}
        <section className="pk-guide-sec">
          <Label>3D-print the tiles</Label>
          <p>
            For multi-material printers (Prusa MMU, Bambu AMS): every gate as a colored 3MF —
            white body, black marker, gate-colored band — as flat tiles (6 mm), chunky cubes
            (60 mm, hollow), and <b>double-faced flip pieces</b>: two gates per piece, one flip
            apart (flip H to get X; flip a rotation to get its inverse). Open a 3MF in your
            slicer and map the pre-colored parts to filament slots; included plate plans group
            each kit into MMU-friendly jobs. Use matte filament — glossy tops glare and hurt
            detection.
          </p>
          <a
            className="pk-guide-download"
            href={tiles3d}
            download="entangible-3d-tiles.zip"
            target="_blank"
            rel="noopener noreferrer"
          >
            Download the 3D tiles (3MF, ZIP)
          </a>
          <p className="pk-guide-muted">
            Rotation-gate variants carry tactile notches (1–4 = π/4, π/2, π, −π/2). Cubes prefer
            a straight-overhead camera — their height parallax-shifts the face at steep angles.
          </p>
        </section>

        {/* 5. The full project */}
        <section className="pk-guide-sec">
          <Label>The full project</Label>
          <p>
            The pocket app's big sibling is a booth installation: a Raspberry Pi kiosk (RasQberry)
            with a large screen, a live camera rig, a phone-camera mode, celebrations and an
            operator panel — built for fairs and events. Same tiles, same board, same engine.
          </p>
          <ul className="pk-guide-links">
            <li>
              <a href={REPO_URL} target="_blank" rel="noopener noreferrer">
                GitHub repository
              </a>
            </li>
            <li>
              <a href={QAMPOSER_URL} target="_blank" rel="noopener noreferrer">
                QAMPoser
              </a>
            </li>
            <li>
              <a href={RASQBERRY_URL} target="_blank" rel="noopener noreferrer">
                RasQberry
              </a>
            </li>
            <li>
              <a href={ISSUES_URL} target="_blank" rel="noopener noreferrer">
                Report an issue
              </a>
            </li>
          </ul>
        </section>

        <footer className="pk-guide-foot">
          Open source, Apache-2.0 licensed. Made for the QAMPoser family.
        </footer>
      </div>

      {viewer.open && board && (
        <div
          ref={stageRef}
          className="pk-viewer"
          role="dialog"
          aria-label={`Test board: ${board.title}`}
        >
          <img className="pk-viewer-img" src={board.src} alt={board.title} />
          {/* Tap zones: left = prev, right = next, center = close. */}
          <button
            type="button"
            className="pk-viewer-zone pk-viewer-prev"
            aria-label="Previous board"
            onClick={() => dispatch({ type: 'prev' })}
          />
          <button
            type="button"
            className="pk-viewer-zone pk-viewer-close"
            aria-label="Close"
            onClick={() => dispatch({ type: 'close' })}
          />
          <button
            type="button"
            className="pk-viewer-zone pk-viewer-next"
            aria-label="Next board"
            onClick={() => dispatch({ type: 'next' })}
          />
          <div className="pk-viewer-index" aria-live="polite">
            {viewer.index + 1} / {TEST_BOARDS.length} · {board.title}
          </div>
        </div>
      )}
    </div>
  );
}

export default GuidePage;
