/**
 * Display-app re-export of the shared frame-streaming core.
 *
 * The pure pacing / backpressure / fps bookkeeping (`StreamController`) and the
 * `/ws/frames` URL + capability helpers moved to `shared/capture` (U2) so the
 * pocket app's CAMERA role streams frames through the exact same core. This shim
 * keeps `CaptureView`'s `./streamController` import working unchanged; the
 * canonical source (and its unit tests) live in `@shared/capture/streamController`.
 */
export * from '@shared/capture/streamController';
