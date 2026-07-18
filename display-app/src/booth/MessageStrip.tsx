/**
 * MessageStrip — the single-line "voice of the app" (docs/booth-ux.md).
 *
 * One message at a time, 32 px @1080p, 300 ms cross-fade, a minimum 4 s dwell,
 * and queue-dropping: if several messages arrive while one is showing, only the
 * most recent survives to be shown next (intermediate ones are dropped).
 *
 * The parent passes the latest message as `{ text, token }`; a new `token`
 * means "a new message happened" (even if the text repeats).
 */
import { useEffect, useRef, useState } from 'react';

export const MIN_DWELL_MS = 4000;
export const FADE_MS = 300;

export interface StripMessage {
  readonly text: string;
  readonly token: number;
}

export function MessageStrip({ message }: { message: StripMessage | null }) {
  const [text, setText] = useState('');
  const [visible, setVisible] = useState(false);

  const pendingRef = useRef<string | null>(null);
  const shownAtRef = useRef<number>(0);
  const timerRef = useRef<number | null>(null);
  const busyRef = useRef(false);

  useEffect(() => {
    if (!message) return;
    // Drop any earlier queued message; keep only the newest.
    pendingRef.current = message.text;
    pump();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [message?.token]);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    };
  }, []);

  function schedule(fn: () => void, ms: number) {
    if (timerRef.current !== null) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(fn, ms);
  }

  function pump() {
    if (busyRef.current) return; // a fade transition is already in flight
    const next = pendingRef.current;
    if (next === null) return;

    const now = Date.now();

    if (!visible) {
      // Nothing showing → show immediately.
      pendingRef.current = null;
      setText(next);
      setVisible(true);
      shownAtRef.current = now;
      return;
    }

    // Something is showing → respect the minimum dwell before swapping.
    const elapsed = now - shownAtRef.current;
    if (elapsed < MIN_DWELL_MS) {
      schedule(pump, MIN_DWELL_MS - elapsed);
      return;
    }

    // Ready to swap: fade out, then fade in the newest pending text.
    busyRef.current = true;
    setVisible(false);
    schedule(() => {
      const latest = pendingRef.current;
      pendingRef.current = null;
      busyRef.current = false;
      if (latest !== null) {
        setText(latest);
        setVisible(true);
        shownAtRef.current = Date.now();
      }
      // A newer message may have queued during the fade.
      if (pendingRef.current !== null) pump();
    }, FADE_MS);
  }

  return (
    <div className="ent-strip" role="status" aria-live="polite">
      <span
        className={`ent-strip__text ${visible ? 'is-visible' : ''}`}
        style={{ transitionDuration: `${FADE_MS}ms` }}
      >
        {text}
      </span>
    </div>
  );
}

export default MessageStrip;
