/**
 * Camera + processing loop for Pocket.
 *
 * - getUserMedia({ facingMode: 'environment', 1280×720 }), playsinline.
 * - A requestAnimationFrame loop grabs frames onto an offscreen canvas and runs
 *   the TS vision pipeline, with adaptive frame skipping: it processes every Nth
 *   frame and tunes N so the pipeline keeps up while the UI stays at 60 fps.
 * - Wake Lock while running; pauses on `visibilitychange` (tab hidden) and
 *   resumes on return.
 * - Secure-context / permission errors surface as `error` for the start card.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import { PocketPipeline, type FrameResult } from '../vision/pipeline';
import { buildVideoConstraints, shouldFallbackToAuto } from './cameraDevices';
import { applyVideoFreeze, shouldProcess, videoFreezeAction } from './freeze';
import {
  applyNativeZoom,
  clampZoom,
  cropRect,
  DIGITAL_ZOOM_RANGE,
  loadZoom,
  readZoomCapability,
  saveZoom,
  stepZoom as stepZoomValue,
  type ZoomRange,
} from './zoom';

export type CameraStatus = 'idle' | 'starting' | 'running' | 'error';

/** 'native' = sensor zoom via applyConstraints; 'digital' = center-crop fallback. */
export type ZoomMode = 'native' | 'digital';

export interface CameraState {
  status: CameraStatus;
  error: string | null;
  fps: number;
  start: () => void;
  stop: () => void;
  videoRef: React.RefObject<HTMLVideoElement>;
  // Zoom
  zoom: number;
  zoomMode: ZoomMode;
  zoomRange: ZoomRange;
  /** CSS scale for the preview <video> (1 for native — the sensor already zoomed). */
  previewScale: number;
  setZoom: (zoom: number) => void;
  stepZoom: (dir: number) => void;
  resetZoom: () => void;
}

interface Options {
  onResult: (result: FrameResult, video: HTMLVideoElement) => void;
  /** Low-power mode: process at most every 2nd frame (docs/pocket.md). */
  lowPower?: boolean;
  /**
   * Freeze: when true the rAF loop stops feeding frames to the pipeline (no new
   * detections / circuit changes) and the preview <video> is paused so the
   * picture visibly holds. Session-momentary; the stream itself stays live.
   */
  paused?: boolean;
  /**
   * Chosen camera `deviceId`, or `null` for automatic rear-facing selection.
   * Changing it while the camera runs restarts the stream on the new device.
   */
  cameraId?: string | null;
  /**
   * Called when a chosen `cameraId` was unavailable and the stream fell back to
   * the automatic camera. The app clears the stored id and shows a gentle toast.
   */
  onCameraFallback?: () => void;
  /**
   * CAMERA role (U2): when set, the rAF loop STREAMS instead of detecting — it
   * draws the zoomed crop (native pixel density, like `/capture`) onto an
   * offscreen canvas and hands it to this sink (which JPEG-encodes + pushes it
   * to the host), and the local vision pipeline is not run. Freeze still gates
   * the loop, so freezing pauses the frame pump; zoom still applies, so the
   * streamed frame IS what the preview shows. `undefined` → normal detection.
   */
  onFrame?: (canvas: HTMLCanvasElement) => void;
}

const TARGET_PROCESS_MS = 45; // aim ~20 detections/s; skip frames to hold it
const ZOOM_STORAGE_KEY = 'entangible.pocket.zoom';

export function useCamera({
  onResult,
  lowPower = false,
  paused = false,
  cameraId = null,
  onCameraFallback,
  onFrame,
}: Options): CameraState {
  const onFrameRef = useRef(onFrame);
  onFrameRef.current = onFrame;
  // Dedicated streaming canvas (kept separate from the detection canvas, which
  // uses a `willReadFrequently` context) so the two modes never fight over one
  // canvas's context type.
  const streamCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const lowPowerRef = useRef(lowPower);
  lowPowerRef.current = lowPower;
  const pausedRef = useRef(paused);
  pausedRef.current = paused;
  const cameraIdRef = useRef(cameraId);
  cameraIdRef.current = cameraId;
  const onCameraFallbackRef = useRef(onCameraFallback);
  onCameraFallbackRef.current = onCameraFallback;
  // Last id the running stream was actually started with — the restart effect
  // compares against it to decide whether a change needs a stop→start.
  const startedWithIdRef = useRef(cameraId);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const pipelineRef = useRef<PocketPipeline>(new PocketPipeline());
  const rafRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);
  const skipRef = useRef(1);
  const frameCountRef = useRef(0);
  const onResultRef = useRef(onResult);
  onResultRef.current = onResult;

  const [status, setStatus] = useState<CameraStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState(0);
  const fpsEmaRef = useRef(0);

  // Zoom state. Start from the persisted value in the digital range; once a
  // stream is running we may swap to a native range and re-clamp.
  const [zoom, setZoomState] = useState(() => loadZoom(ZOOM_STORAGE_KEY, 1));
  const [zoomMode, setZoomMode] = useState<ZoomMode>('digital');
  const [zoomRange, setZoomRange] = useState<ZoomRange>(DIGITAL_ZOOM_RANGE);
  const trackRef = useRef<MediaStreamTrack | null>(null);
  const zoomModeRef = useRef<ZoomMode>('digital'); // read by the rAF loop
  const digitalZoomRef = useRef(1); // crop factor for the loop (1 when native)

  const applyZoom = useCallback((next: number, mode: ZoomMode) => {
    setZoomState(next);
    saveZoom(ZOOM_STORAGE_KEY, next);
    if (mode === 'native') {
      digitalZoomRef.current = 1;
      const track = trackRef.current;
      if (track) void applyNativeZoom(track, next);
    } else {
      digitalZoomRef.current = next;
    }
  }, []);

  const requestWakeLock = useCallback(async () => {
    try {
      if ('wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
      }
    } catch {
      /* wake lock is best-effort */
    }
  }, []);

  const loop = useCallback(() => {
    const video = videoRef.current;
    if (!video || video.readyState < 2) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    // Frozen: keep the rAF alive (so unfreeze resumes cleanly) but feed no
    // frames to the pipeline / stream — the last picture and circuit hold. In
    // the camera role this is exactly the freeze semantic: the frame pump pauses.
    if (!shouldProcess(pausedRef.current)) {
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    // CAMERA role: stream the zoomed crop instead of detecting. Drawn at native
    // pixel density (canvas sized to the crop, like `/capture`) so the streamed
    // JPEG *is* the zoomed region; the sink paces itself, so we offer every rAF.
    const sink = onFrameRef.current;
    if (sink) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w > 0 && h > 0) {
        if (!streamCanvasRef.current) streamCanvasRef.current = document.createElement('canvas');
        const canvas = streamCanvasRef.current;
        const { sx, sy, sw, sh } = cropRect(digitalZoomRef.current, w, h);
        if (canvas.width !== sw) canvas.width = sw;
        if (canvas.height !== sh) canvas.height = sh;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, sw, sh);
          sink(canvas);
        }
      }
      rafRef.current = requestAnimationFrame(loop);
      return;
    }
    frameCountRef.current += 1;
    if (frameCountRef.current % skipRef.current === 0) {
      const w = video.videoWidth;
      const h = video.videoHeight;
      if (w > 0 && h > 0) {
        if (!canvasRef.current) canvasRef.current = document.createElement('canvas');
        const canvas = canvasRef.current;
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        const ctx = canvas.getContext('2d', { willReadFrequently: true });
        if (ctx) {
          // Digital zoom: center-crop 1/zoom of the frame straight into the
          // full canvas (source-rect drawImage — no extra full-frame copy). At
          // zoom 1 (or native mode) this is the identity full-frame draw. The
          // detector then works in this zoomed canvas-pixel space, which is the
          // same space the overlay and CSS-scaled preview render in.
          const { sx, sy, sw, sh } = cropRect(digitalZoomRef.current, w, h);
          ctx.drawImage(video, sx, sy, sw, sh, 0, 0, w, h);
          const image = ctx.getImageData(0, 0, w, h);
          const t0 = performance.now();
          const result = pipelineRef.current.processFrame({
            data: image.data,
            width: w,
            height: h,
          });
          const dt = performance.now() - t0;

          // Adaptive frame skipping: keep the pipeline near TARGET_PROCESS_MS.
          const skipFloor = lowPowerRef.current ? 2 : 1;
          if (dt > TARGET_PROCESS_MS && skipRef.current < 6) skipRef.current += 1;
          else if (dt < TARGET_PROCESS_MS * 0.5 && skipRef.current > skipFloor)
            skipRef.current -= 1;
          if (skipRef.current < skipFloor) skipRef.current = skipFloor;

          const inst = dt > 0 ? 1000 / dt : 0;
          fpsEmaRef.current = fpsEmaRef.current === 0 ? inst : 0.3 * inst + 0.7 * fpsEmaRef.current;
          setFps(Math.round(fpsEmaRef.current / skipRef.current));

          onResultRef.current(result, video);
        }
      }
    }
    rafRef.current = requestAnimationFrame(loop);
  }, []);

  const stop = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      for (const track of streamRef.current.getTracks()) track.stop();
      streamRef.current = null;
    }
    trackRef.current = null;
    if (wakeLockRef.current) {
      wakeLockRef.current.release().catch(() => undefined);
      wakeLockRef.current = null;
    }
    pipelineRef.current.reset();
    setStatus('idle');
    setFps(0);
  }, []);

  const start = useCallback(async () => {
    setError(null);
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      setStatus('error');
      setError(
        'Camera needs a secure context (HTTPS or localhost). Open this page over HTTPS and allow camera access.',
      );
      return;
    }
    setStatus('starting');
    try {
      // A chosen camera targets one device (deviceId: exact); null asks for the
      // rear-facing camera. If a stored device is gone the exact request rejects
      // — retry once on the automatic constraint, tell the app to clear the id,
      // and surface a gentle toast (onCameraFallback → App).
      const wantId = cameraIdRef.current;
      startedWithIdRef.current = wantId;
      let stream: MediaStream;
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          video: buildVideoConstraints({ cameraId: wantId }),
          audio: false,
        });
      } catch (err) {
        if (!shouldFallbackToAuto(wantId, err)) throw err;
        stream = await navigator.mediaDevices.getUserMedia({
          video: buildVideoConstraints({ cameraId: null }),
          audio: false,
        });
        // We are now on the automatic camera. Record that so the id-reset the
        // fallback triggers (cameraId → null) doesn't bounce the stream again.
        startedWithIdRef.current = null;
        onCameraFallbackRef.current?.();
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play();

      // Native vs digital zoom selection. iOS/iPadOS Safari does not expose a
      // `zoom` capability on getUserMedia tracks, so it always lands on the
      // digital path — which is why the pocket app is built around the crop.
      const track = stream.getVideoTracks()[0] ?? null;
      trackRef.current = track;
      const native = track ? readZoomCapability(track) : null;
      if (native) {
        setZoomMode('native');
        zoomModeRef.current = 'native';
        setZoomRange(native);
        const clamped = clampZoom(zoom, native.min, native.max);
        applyZoom(clamped, 'native');
      } else {
        setZoomMode('digital');
        zoomModeRef.current = 'digital';
        setZoomRange(DIGITAL_ZOOM_RANGE);
        const clamped = clampZoom(zoom, DIGITAL_ZOOM_RANGE.min, DIGITAL_ZOOM_RANGE.max);
        applyZoom(clamped, 'digital');
      }

      pipelineRef.current.reset();
      skipRef.current = 1;
      frameCountRef.current = 0;
      fpsEmaRef.current = 0;
      setStatus('running');
      await requestWakeLock();
      rafRef.current = requestAnimationFrame(loop);
    } catch (err) {
      setStatus('error');
      const name = (err as DOMException)?.name;
      setError(
        name === 'NotAllowedError'
          ? 'Camera permission was denied. Allow camera access in your browser settings and try again.'
          : name === 'NotFoundError'
            ? 'No camera was found on this device.'
            : `Could not start the camera (${name ?? 'unknown error'}).`,
      );
    }
  }, [loop, requestWakeLock, zoom, applyZoom]);

  // Pause processing when the tab is hidden; resume (and re-acquire wake lock)
  // when it returns.
  useEffect(() => {
    function onVisibility() {
      if (document.hidden) {
        if (rafRef.current !== null) {
          cancelAnimationFrame(rafRef.current);
          rafRef.current = null;
        }
      } else if (status === 'running' && rafRef.current === null && streamRef.current) {
        requestWakeLock();
        rafRef.current = requestAnimationFrame(loop);
      }
    }
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, [status, loop, requestWakeLock]);

  // Live camera switch: when the chosen device differs from the one the running
  // stream was started with, restart on the new one — stop→start with the new
  // constraint (start reads the latest id via cameraIdRef). While idle it's a
  // no-op; the next manual Start picks up the new id. Comparing against the
  // id the stream actually started with (not the previous prop) means the
  // fallback's own cameraId→null reset does not bounce the stream.
  const statusRef = useRef(status);
  statusRef.current = status;
  useEffect(() => {
    if (startedWithIdRef.current === cameraId) return;
    if (statusRef.current === 'running' || statusRef.current === 'starting') {
      stop();
      void start();
    } else {
      startedWithIdRef.current = cameraId;
    }
  }, [cameraId, stop, start]);

  useEffect(() => () => stop(), [stop]);

  // Freeze/unfreeze the preview picture: pause the <video> while frozen, resume
  // it while live. Session-momentary — the MediaStream keeps running underneath.
  useEffect(() => {
    applyVideoFreeze(videoRef.current, videoFreezeAction(paused, status === 'running'));
  }, [paused, status]);

  // ---- zoom controls ----------------------------------------------------
  const setZoom = useCallback(
    (next: number) => {
      applyZoom(clampZoom(next, zoomRange.min, zoomRange.max), zoomModeRef.current);
    },
    [applyZoom, zoomRange.min, zoomRange.max],
  );

  const stepZoom = useCallback(
    (dir: number) => {
      applyZoom(
        stepZoomValue(zoom, dir, zoomRange.step, zoomRange.min, zoomRange.max),
        zoomModeRef.current,
      );
    },
    [applyZoom, zoom, zoomRange.step, zoomRange.min, zoomRange.max],
  );

  const resetZoom = useCallback(() => {
    applyZoom(clampZoom(1, zoomRange.min, zoomRange.max), zoomModeRef.current);
  }, [applyZoom, zoomRange.min, zoomRange.max]);

  const previewScale = zoomMode === 'digital' ? zoom : 1;

  return {
    status,
    error,
    fps,
    start,
    stop,
    videoRef,
    zoom,
    zoomMode,
    zoomRange,
    previewScale,
    setZoom,
    stepZoom,
    resetZoom,
  };
}
