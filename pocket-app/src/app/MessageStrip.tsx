/**
 * MessageStrip — the single-line "voice of the app", ported from the booth's
 * `display-app/src/booth/MessageStrip.tsx` (same queue-drop + min-dwell logic),
 * restyled with `pk-` classes. One message at a time, 300 ms cross-fade, min 4 s
 * dwell; intermediate messages are dropped if several queue.
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
    if (busyRef.current) return;
    const next = pendingRef.current;
    if (next === null) return;

    const now = Date.now();
    if (!visible) {
      pendingRef.current = null;
      setText(next);
      setVisible(true);
      shownAtRef.current = now;
      return;
    }

    const elapsed = now - shownAtRef.current;
    if (elapsed < MIN_DWELL_MS) {
      schedule(pump, MIN_DWELL_MS - elapsed);
      return;
    }

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
      if (pendingRef.current !== null) pump();
    }, FADE_MS);
  }

  return (
    <div className="pk-strip" role="status" aria-live="polite">
      <span
        className={`pk-strip__text ${visible ? 'is-visible' : ''}`}
        style={{ transitionDuration: `${FADE_MS}ms` }}
      >
        {text}
      </span>
    </div>
  );
}

export default MessageStrip;
