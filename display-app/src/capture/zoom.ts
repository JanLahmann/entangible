/**
 * Pure camera-zoom math + persistence for the /capture phone page.
 *
 * No DOM dependencies (beyond an optional `localStorage`), so all of it is
 * unit-tested with plain values. Two zoom strategies share this math:
 *
 *  - **native**  — the capture track exposes a `zoom` capability, applied via
 *    `track.applyConstraints({ advanced: [{ zoom }] })`. The sensor zooms; we
 *    never crop, and the streamed JPEG is the full (sensor-zoomed) frame.
 *  - **digital** — no native zoom, so `CaptureView` center-crops `1/zoom` of the
 *    frame in the existing `drawImage` (source-rect form) and encodes only that
 *    region: the streamed JPEG *is* the cropped region, at its native pixel
 *    density (the frame is grabbed at 1080p for the extra pixels-per-marker).
 *    The range is the fixed 1.0–3.0 / step 0.25 below.
 */

export const ZOOM_MIN = 1;
export const ZOOM_MAX = 3;
export const ZOOM_STEP = 0.25;

export interface ZoomRange {
  readonly min: number;
  readonly max: number;
  readonly step: number;
}

export const DIGITAL_ZOOM_RANGE: ZoomRange = { min: ZOOM_MIN, max: ZOOM_MAX, step: ZOOM_STEP };

/** A source rectangle for `ctx.drawImage(video, sx, sy, sw, sh, …)`. */
export interface CropRect {
  readonly sx: number;
  readonly sy: number;
  readonly sw: number;
  readonly sh: number;
}

/** Clamp a zoom value into `[min, max]`; non-finite input falls back to `min`. */
export function clampZoom(zoom: number, min = ZOOM_MIN, max = ZOOM_MAX): number {
  if (!Number.isFinite(zoom)) return min;
  return Math.min(max, Math.max(min, zoom));
}

/** Snap a zoom value to the nearest `step` boundary within `[min, max]`. */
export function snapZoom(zoom: number, step = ZOOM_STEP, min = ZOOM_MIN, max = ZOOM_MAX): number {
  if (!Number.isFinite(zoom)) return min;
  if (!(step > 0)) return clampZoom(zoom, min, max);
  const snapped = Math.round((zoom - min) / step) * step + min;
  // Kill binary-float dust (e.g. 1.7500000000000002) so the chip reads "1.75×".
  return clampZoom(Math.round(snapped * 1e6) / 1e6, min, max);
}

/**
 * One +/- button press: snap the current value to the grid, then move one step.
 * `dir` is +1 (in) or -1 (out).
 */
export function stepZoom(
  zoom: number,
  dir: number,
  step = ZOOM_STEP,
  min = ZOOM_MIN,
  max = ZOOM_MAX,
): number {
  return snapZoom(snapZoom(zoom, step, min, max) + Math.sign(dir) * step, step, min, max);
}

/**
 * Center-crop rectangle covering `1/zoom` of each dimension, in integer pixels,
 * clamped to the frame. At `zoom <= 1` this is the whole frame (sx=sy=0), so the
 * caller's `drawImage` reduces to the original full-frame copy — no extra work.
 */
export function cropRect(zoom: number, width: number, height: number): CropRect {
  const z = Number.isFinite(zoom) && zoom > 1 ? zoom : 1;
  const sw = Math.max(1, Math.min(width, Math.round(width / z)));
  const sh = Math.max(1, Math.min(height, Math.round(height / z)));
  const sx = Math.max(0, Math.round((width - sw) / 2));
  const sy = Math.max(0, Math.round((height - sh) / 2));
  return { sx, sy, sw, sh };
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Euclidean distance between two pointers (for pinch gestures). */
export function pointerDistance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Map an in-progress pinch to a new zoom: the zoom at gesture start scaled by
 * the ratio of the current two-finger distance to the start distance, clamped
 * to `[min, max]`. A non-positive start distance leaves the zoom unchanged.
 */
export function pinchZoom(
  startZoom: number,
  startDist: number,
  currentDist: number,
  min = ZOOM_MIN,
  max = ZOOM_MAX,
): number {
  if (!(startDist > 0)) return clampZoom(startZoom, min, max);
  return clampZoom(startZoom * (currentDist / startDist), min, max);
}

// ---------------------------------------------------------------------------
// Native-zoom capability probing (lib.dom lacks `zoom`, so extend narrowly).
// ---------------------------------------------------------------------------

interface ZoomCapabilityRaw {
  readonly min?: number;
  readonly max?: number;
  readonly step?: number;
}
type CapabilitiesWithZoom = MediaTrackCapabilities & { zoom?: ZoomCapabilityRaw };
type ConstraintsWithZoom = MediaTrackConstraints & {
  advanced?: Array<MediaTrackConstraintSet & { zoom?: number }>;
};

/**
 * Read a usable native zoom range off a track, or `null` when the track cannot
 * zoom (the digital path is used instead). A capability is "usable" only when
 * `max > min`.
 */
export function readZoomCapability(track: MediaStreamTrack): ZoomRange | null {
  const getCaps = track.getCapabilities?.bind(track);
  if (!getCaps) return null;
  const caps = getCaps() as CapabilitiesWithZoom;
  const z = caps.zoom;
  if (!z || typeof z.min !== 'number' || typeof z.max !== 'number' || !(z.max > z.min)) {
    return null;
  }
  const step = typeof z.step === 'number' && z.step > 0 ? z.step : ZOOM_STEP;
  return { min: z.min, max: z.max, step };
}

/** Apply a native zoom to the track. Best-effort; rejects are swallowed. */
export function applyNativeZoom(track: MediaStreamTrack, zoom: number): Promise<void> {
  const constraints: ConstraintsWithZoom = { advanced: [{ zoom }] };
  return track.applyConstraints(constraints).catch(() => undefined);
}

// ---------------------------------------------------------------------------
// Persistence (last zoom per surface).
// ---------------------------------------------------------------------------

function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** Read a persisted zoom, clamped to `[min, max]`; falls back on missing/bad data. */
export function loadZoom(key: string, fallback = ZOOM_MIN, min = ZOOM_MIN, max = ZOOM_MAX): number {
  const raw = storage()?.getItem(key);
  if (raw == null) return clampZoom(fallback, min, max);
  const v = Number.parseFloat(raw);
  return Number.isFinite(v) ? clampZoom(v, min, max) : clampZoom(fallback, min, max);
}

/** Persist the current zoom for this surface. Best-effort. */
export function saveZoom(key: string, zoom: number): void {
  try {
    storage()?.setItem(key, String(zoom));
  } catch {
    /* private-mode / quota — persistence is best-effort */
  }
}
