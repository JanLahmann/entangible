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

export type CameraStatus = 'idle' | 'starting' | 'running' | 'error';

export interface CameraState {
  status: CameraStatus;
  error: string | null;
  fps: number;
  start: () => void;
  stop: () => void;
  videoRef: React.RefObject<HTMLVideoElement>;
}

interface Options {
  onResult: (result: FrameResult, video: HTMLVideoElement) => void;
}

const TARGET_PROCESS_MS = 45; // aim ~20 detections/s; skip frames to hold it

export function useCamera({ onResult }: Options): CameraState {
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
          ctx.drawImage(video, 0, 0, w, h);
          const image = ctx.getImageData(0, 0, w, h);
          const t0 = performance.now();
          const result = pipelineRef.current.processFrame({
            data: image.data,
            width: w,
            height: h,
          });
          const dt = performance.now() - t0;

          // Adaptive frame skipping: keep the pipeline near TARGET_PROCESS_MS.
          if (dt > TARGET_PROCESS_MS && skipRef.current < 6) skipRef.current += 1;
          else if (dt < TARGET_PROCESS_MS * 0.5 && skipRef.current > 1) skipRef.current -= 1;

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
      const stream = await navigator.mediaDevices.getUserMedia({
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280 },
          height: { ideal: 720 },
        },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) return;
      video.srcObject = stream;
      video.setAttribute('playsinline', 'true');
      video.muted = true;
      await video.play();
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
  }, [loop, requestWakeLock]);

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

  useEffect(() => () => stop(), [stop]);

  return { status, error, fps, start, stop, videoRef };
}
