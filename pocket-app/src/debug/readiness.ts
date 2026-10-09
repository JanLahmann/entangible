/**
 * READY traffic light for /debug: the four things a booth needs before a
 * visitor walks up, each with the one-line fix staff should try first.
 *
 * Pure (no clock, no socket): `DebugView` supplies the ages it tracks, so every
 * combination is table-testable. READY means ALL rows are green — there is no
 * partial readiness at a booth.
 */
import type { CameraStatus } from '@shared/ws/messages';
import type { ConnectionState } from '@shared/ws/stateSocket';

/** A detection older than this means frames stopped arriving. */
export const FRAME_STALE_MS = 3000;
/** A board sighting older than this is no longer "recent" (no "seen Xs ago"). */
export const BOARD_RECENT_MS = 10 * 60_000;

export type ReadinessKey = 'link' | 'camera' | 'frames' | 'board';

export interface ReadinessInput {
  connectionState: ConnectionState;
  camera: CameraStatus | undefined;
  /** Latest `detection.fps` (undefined before the first detection). */
  fps: number | undefined;
  /** ms since the last `detection` message; null when none has arrived. */
  detectionAgeMs: number | null;
  /** Latest `detection.board.found`. */
  boardFound: boolean;
  /** ms since the board was last found; null when never. */
  boardSeenAgoMs: number | null;
}

export interface ReadinessRow {
  key: ReadinessKey;
  label: string;
  ok: boolean;
  /** What is true right now (always shown). */
  detail: string;
  /** The first fix to try (shown when the row is red). */
  hint: string;
}

export interface Readiness {
  ready: boolean;
  rows: ReadinessRow[];
}

export const READINESS_HINTS: Record<ReadinessKey, string> = {
  link: 'reload / check the host is running',
  camera: 'check the cable, or pick another camera below',
  frames: 'no frames arriving — wrong camera index?',
  board: 'point the camera at the mat; check the 4 corner blocks',
};

function secs(ms: number): string {
  return `${Math.max(0, Math.round(ms / 1000))}s`;
}

function cameraDetail(camera: CameraStatus | undefined): string {
  if (!camera) return 'no status from host';
  const name = camera.name ? ` (${camera.name})` : '';
  const state = camera.lost ? 'LOST' : camera.connected ? 'connected' : 'offline';
  return `${camera.kind}${name} · ${state}`;
}

export function readiness(input: ReadinessInput): Readiness {
  const { connectionState, camera, fps, detectionAgeMs, boardFound, boardSeenAgoMs } = input;

  const linkOk = connectionState === 'open';
  const cameraOk = !!camera && camera.connected && !camera.lost;
  const fresh = detectionAgeMs !== null && detectionAgeMs <= FRAME_STALE_MS;
  const framesOk = typeof fps === 'number' && fps > 0 && fresh;

  let framesDetail: string;
  if (detectionAgeMs === null) framesDetail = 'no detection yet';
  else if (!fresh) framesDetail = `last detection ${secs(detectionAgeMs)} ago`;
  else framesDetail = `${(fps ?? 0).toFixed(1)} fps`;

  let boardDetail: string;
  if (boardFound) boardDetail = 'board found';
  else if (boardSeenAgoMs !== null && boardSeenAgoMs <= BOARD_RECENT_MS)
    boardDetail = `board seen ${secs(boardSeenAgoMs)} ago`;
  else boardDetail = 'board not seen';

  const rows: ReadinessRow[] = [
    { key: 'link', label: 'host link', ok: linkOk, detail: `ws ${connectionState}`, hint: READINESS_HINTS.link },
    { key: 'camera', label: 'camera', ok: cameraOk, detail: cameraDetail(camera), hint: READINESS_HINTS.camera },
    { key: 'frames', label: 'frames', ok: framesOk, detail: framesDetail, hint: READINESS_HINTS.frames },
    { key: 'board', label: 'board', ok: boardFound, detail: boardDetail, hint: READINESS_HINTS.board },
  ];
  return { ready: rows.every((r) => r.ok), rows };
}
