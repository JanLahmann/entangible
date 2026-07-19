/**
 * Booth connection helpers — pure, testable (Entangible One, phase U1b).
 *
 * Covers the manual "Booth" settings field (normalize a host URL to the
 * `/ws/state` endpoint), the visitor-QR `?connect=1` auto-connect trigger, the
 * status-pill label, and the camera hand-off when switching local ⇄ booth.
 */
import type { ConnectionPhase } from './StateSource';

/**
 * Normalize a user-entered booth address into a `ws(s)://host/ws/state` URL,
 * or `null` when it cannot be made into one.
 *
 * Accepts `wss://host:8443`, `ws://host`, `https://host:8443`,
 * `http://host:8443`, or a bare `host:8443` (assumed secure → `wss`). Any path
 * or query the user typed is dropped and replaced with `/ws/state`.
 */
export function normalizeBoothUrl(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  if (/^https:\/\//i.test(s)) s = 'wss://' + s.slice('https://'.length);
  else if (/^http:\/\//i.test(s)) s = 'ws://' + s.slice('http://'.length);
  else if (!/^wss?:\/\//i.test(s)) s = 'wss://' + s; // bare host → secure default

  let url: URL;
  try {
    url = new URL(s);
  } catch {
    return null;
  }
  if ((url.protocol !== 'ws:' && url.protocol !== 'wss:') || !url.host) return null;
  return `${url.protocol}//${url.host}/ws/state`;
}

function boolish(v: string | null): boolean {
  return v === '1' || v === 'true' || v === 'yes' || v === 'on';
}

/**
 * Does the URL request an auto-connect? `?connect=1` is the visitor-QR form
 * (the host encodes `…/pocket?connect=1`).
 */
export function connectRequested(search: string): boolean {
  const params = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search);
  return boolish(params.get('connect'));
}

/** Status-pill label + style hook for the current booth connection phase. */
export function connectionPill(phase: ConnectionPhase): { label: string; cls: string } {
  switch (phase) {
    case 'open':
      return { label: 'Connected to booth · viewing', cls: 'is-live' };
    case 'connecting':
      return { label: 'Connecting to booth…', cls: 'is-searching' };
    case 'closed':
      return { label: 'Booth disconnected', cls: 'is-off' };
  }
}

/** What to do with the camera when the active source switches. */
export interface CameraSwitch {
  /** Stop the on-device camera (entering booth viewer mode). */
  readonly stop: boolean;
  /** Resume the on-device camera (returning to standalone). */
  readonly start: boolean;
  /** Whether to remember that the camera was running, for a later resume. */
  readonly remember: boolean;
}

/**
 * Decide the camera hand-off. Entering booth mode always stops the camera and
 * remembers whether it was active; returning to standalone resumes it only if
 * it was running before we connected — so a disconnect cleanly restores the
 * local pipeline (design: "camera resumes").
 */
export function cameraSwitchAction(
  nowConnected: boolean,
  cameraActive: boolean,
  wasRunning: boolean,
): CameraSwitch {
  if (nowConnected) return { stop: true, start: false, remember: cameraActive };
  return { stop: false, start: wasRunning, remember: false };
}
