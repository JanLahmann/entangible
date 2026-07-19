/**
 * VisitorQr — the public "follow along + take your circuit home" QR
 * (Entangible One, phase U1b / take-it-home T2).
 *
 * Fetched from the host's UNGATED `GET /api/visitor-qr` (encodes
 * `…/pocket?connect=1`, no operator token — safe to show visitors, unlike the
 * staff `/capture` QR which stays on `/debug`). Rendered small in the booth
 * footer and a bit larger on the attract screen. It probes the endpoint first
 * and renders nothing when unavailable (e.g. running the display app under
 * `vite` with no host), so it never shows a broken image.
 */
import { useEffect, useState } from 'react';

const VISITOR_QR_SRC = '/api/visitor-qr';
const LABEL = 'Scan to follow along + take your circuit home';

export function VisitorQr({ variant }: { variant: 'footer' | 'attract' }) {
  const [available, setAvailable] = useState(false);
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => {
      if (alive) setAvailable(true);
    };
    img.onerror = () => {
      if (alive) setAvailable(false);
    };
    img.src = VISITOR_QR_SRC;
    return () => {
      alive = false;
    };
  }, []);

  if (!available) return null;

  if (variant === 'attract') {
    return (
      <div className="ent-attract__qr">
        <img src={VISITOR_QR_SRC} alt={LABEL} />
        <span className="ent-attract__qr-label">{LABEL}</span>
      </div>
    );
  }

  return (
    <div className="bo-visitor-qr" title={LABEL}>
      <img src={VISITOR_QR_SRC} alt={LABEL} />
      <span className="bo-visitor-qr__label">{LABEL}</span>
    </div>
  );
}

export default VisitorQr;
