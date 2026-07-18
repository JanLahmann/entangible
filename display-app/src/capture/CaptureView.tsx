/**
 * CaptureView (/capture) — M4 placeholder.
 *
 * The real page will use getUserMedia to stream JPEG frames to the host over
 * `/ws/frames` (with `bufferedAmount` backpressure and a wake lock). For now it
 * exists so the QR → phone flow and routing can be exercised end to end.
 */
export function CaptureView() {
  return (
    <div className="capture">
      <div className="capture__card">
        <h1 className="capture__title">Entangible — phone camera</h1>
        <p className="capture__lead">Phone camera capture arrives in M4.</p>
        <p className="capture__note">
          This page will let your phone stream its camera to the booth so it can
          read the tiles on the table. Nothing to do here yet.
        </p>
      </div>
    </div>
  );
}

export default CaptureView;
