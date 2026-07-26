/**
 * "Challenge a friend" (#84) — the random course's share link as a QR.
 *
 * A generated course is fully determined by its seed (#78), so handing someone
 * the code hands them the identical eighteen holes. Typing a code works; across
 * a table, pointing a phone at a screen works better. This is the same overlay
 * and the same pure-JS QR renderer the Composer hand-off uses (#37) — no second
 * QR stack, no canvas, so it renders in jsdom tests too.
 *
 * Pocket only: the shared scorecard takes this as an injected renderer, so the
 * kiosk — which stays on the classic course by design and has no code to share
 * — never pulls the QR dependency in.
 */
import { useEffect, useState } from 'react';
import { renderQrSvg } from './composerQrCode';

const HINT = 'Scan to play the same course — same 18 holes, same pars.';
const SUBHINT = 'Compare strokes and time when you both finish.';

export function CourseChallenge({ code, link }: { code: string; link: string }) {
  const [open, setOpen] = useState(false);
  const [svg, setSvg] = useState('');

  useEffect(() => {
    if (!open) return;
    let live = true;
    // A course link is short, so error-correction M always fits — no capacity
    // guard needed here, unlike the Composer's whole-circuit payload.
    void renderQrSvg(link, 'M').then((markup) => {
      if (live) setSvg(markup);
    });
    return () => {
      live = false;
    };
  }, [open, link]);

  const close = () => setOpen(false);

  return (
    <>
      <button
        type="button"
        className="pk-golf-challenge"
        onClick={() => setOpen(true)}
        aria-label="Challenge a friend to this course"
        title="Show a QR code for this course"
      >
        Challenge
      </button>

      {open && (
        <div
          className="pk-qr-overlay"
          role="dialog"
          aria-label="Challenge a friend — QR code for this course"
          onClick={close}
        >
          <div className="pk-qr-card" onClick={(e) => e.stopPropagation()}>
            <button type="button" className="pk-qr-close" aria-label="Close" onClick={close}>
              ✕
            </button>
            <div
              className="pk-qr-code"
              // qrcode emits a self-contained SVG string; safe, locally generated.
              dangerouslySetInnerHTML={{ __html: svg }}
            />
            <p className="pk-qr-caption">{HINT}</p>
            <p className="pk-golf-challenge-code">Course #{code}</p>
            <p className="pk-qr-disclaimer">{SUBHINT}</p>
          </div>
        </div>
      )}
    </>
  );
}

export default CourseChallenge;
