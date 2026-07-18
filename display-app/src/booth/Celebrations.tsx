/**
 * Celebrations overlay — hand-rolled canvas confetti + a scale-in banner.
 *
 * No animation libraries (per M3 constraints): a single full-screen <canvas>
 * driven by requestAnimationFrame, plus a CSS-animated banner. A burst is fired
 * whenever `celebration.token` changes (the parent bumps the token so the same
 * celebration kind can re-fire after a board-clear cycle).
 *
 * Budget (docs/booth-ux.md → Principles): ≤ 150 particles, four gate colours,
 * bursts from the bottom corners with gravity, 1.8 s life; `?lowpower` caps the
 * count at 60 for the Pi 4.
 */
import { useEffect, useRef, useState } from 'react';
import type { Celebration } from '../quantum/moments';

/** The four gate colours (H / X / Y / Z). */
const COLORS = ['#fa4d56', '#002d9c', '#9f1853', '#33b1ff'] as const;

const PARTICLE_LIFE_MS = 1800;
const GRAVITY = 1400; // px / s²
const BELL_PARTICLES = 100;
const GHZ_PARTICLES = 150;
const LOWPOWER_CAP = 60;

const BANNER_HOLD_MS = 2500;
const BANNER_FADE_MS = 500;

/** A celebration request. `token` must change on every distinct fire. */
export interface CelebrationRequest extends Celebration {
  readonly token: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  born: number;
}

function isLowPower(): boolean {
  if (typeof window === 'undefined') return false;
  return new URLSearchParams(window.location.search).has('lowpower');
}

/** Particle budget for a celebration, respecting the low-power cap. */
function particleBudget(kind: Celebration['kind']): number {
  const base = kind === 'ghz' ? GHZ_PARTICLES : BELL_PARTICLES;
  return isLowPower() ? Math.min(LOWPOWER_CAP, base) : base;
}

export function Celebrations({ celebration }: { celebration: CelebrationRequest | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  const [banner, setBanner] = useState<{ text: string; kind: Celebration['kind']; token: number } | null>(
    null,
  );
  const [bannerPhase, setBannerPhase] = useState<'in' | 'out'>('in');

  // --- confetti + banner fire on each new token -----------------------------
  useEffect(() => {
    if (!celebration) return;

    spawnBurst(celebration.kind);
    startLoop();

    const text =
      celebration.kind === 'ghz'
        ? `GHZ STATE — ${celebration.k} QUBITS ENTANGLED!`
        : 'ENTANGLEMENT!';
    setBanner({ text, kind: celebration.kind, token: celebration.token });
    setBannerPhase('in');

    const holdTimer = window.setTimeout(() => setBannerPhase('out'), BANNER_HOLD_MS);
    const clearTimer = window.setTimeout(
      () => setBanner(null),
      BANNER_HOLD_MS + BANNER_FADE_MS,
    );
    return () => {
      window.clearTimeout(holdTimer);
      window.clearTimeout(clearTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebration?.token]);

  // --- cleanup on unmount ---------------------------------------------------
  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  function canvasSize(): { w: number; h: number } {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function spawnBurst(kind: Celebration['kind']) {
    const { w, h } = canvasSize();
    const budget = particleBudget(kind);
    const now = performance.now();
    const half = Math.ceil(budget / 2);
    const ps = particlesRef.current;
    for (let corner = 0; corner < 2; corner++) {
      const originX = corner === 0 ? 0 : w;
      const dir = corner === 0 ? 1 : -1; // inward
      for (let i = 0; i < half && ps.length < GHZ_PARTICLES; i++) {
        const speed = 700 + Math.random() * 600;
        const angle = (Math.random() * 55 + 20) * (Math.PI / 180); // 20°–75° above horizontal
        ps.push({
          x: originX,
          y: h,
          vx: dir * Math.cos(angle) * speed,
          vy: -Math.sin(angle) * speed,
          color: COLORS[Math.floor(Math.random() * COLORS.length)],
          born: now,
        });
      }
    }
  }

  function startLoop() {
    if (rafRef.current !== null) return;
    lastTickRef.current = performance.now();
    const tick = (t: number) => {
      const canvas = canvasRef.current;
      const dt = Math.min(0.05, (t - lastTickRef.current) / 1000);
      lastTickRef.current = t;

      if (canvas) {
        const { w, h } = canvasSize();
        if (canvas.width !== w) canvas.width = w;
        if (canvas.height !== h) canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.clearRect(0, 0, w, h);
          const ps = particlesRef.current;
          const alive: Particle[] = [];
          for (const p of ps) {
            const age = t - p.born;
            if (age > PARTICLE_LIFE_MS || p.y > h + 20) continue;
            p.vy += GRAVITY * dt;
            p.x += p.vx * dt;
            p.y += p.vy * dt;
            ctx.globalAlpha = Math.max(0, 1 - age / PARTICLE_LIFE_MS);
            ctx.fillStyle = p.color;
            ctx.fillRect(p.x - 4, p.y - 4, 8, 8);
            alive.push(p);
          }
          ctx.globalAlpha = 1;
          particlesRef.current = alive;
        }
      }

      if (particlesRef.current.length > 0) {
        rafRef.current = requestAnimationFrame(tick);
      } else {
        rafRef.current = null;
        const ctx = canvasRef.current?.getContext('2d');
        if (ctx && canvasRef.current) {
          ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height);
        }
      }
    };
    rafRef.current = requestAnimationFrame(tick);
  }

  return (
    <div className="ent-celebrate" aria-hidden="true">
      <canvas ref={canvasRef} className="ent-celebrate__canvas" />
      {banner && (
        <div
          key={banner.token}
          className={`ent-banner ent-banner--${banner.kind} ent-banner--${bannerPhase}`}
          role="status"
        >
          {banner.text}
        </div>
      )}
    </div>
  );
}

export default Celebrations;
