/**
 * Celebrations overlay — hand-rolled canvas confetti + a scale-in banner,
 * ported from the booth's `display-app/src/booth/Celebrations.tsx`. No animation
 * libraries: one full-screen <canvas> driven by rAF plus a CSS-animated banner.
 *
 * Tablet budget (docs/pocket.md): confetti is capped at 100 particles for both
 * Bell and GHZ (the booth allows 150). Fires whenever `celebration.token`
 * changes, so the same kind can re-fire after a board-clear cycle.
 */
import { useEffect, useRef, useState } from 'react';
import type { Celebration } from '@quantum/moments';

/** The four gate colours (H / X / Y / Z). */
const COLORS = ['#fa4d56', '#002d9c', '#9f1853', '#33b1ff'] as const;

const PARTICLE_LIFE_MS = 1800;
const GRAVITY = 1400; // px / s²
const MAX_PARTICLES = 100; // tablet budget (both Bell and GHZ)

const BANNER_HOLD_MS = 2500;
const BANNER_FADE_MS = 500;

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

export function Celebrations({ celebration }: { celebration: CelebrationRequest | null }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  const [banner, setBanner] = useState<{
    text: string;
    kind: Celebration['kind'];
    token: number;
  } | null>(null);
  const [bannerPhase, setBannerPhase] = useState<'in' | 'out'>('in');

  useEffect(() => {
    if (!celebration) return;

    spawnBurst();
    startLoop();

    const text =
      celebration.kind === 'ghz'
        ? `GHZ STATE — ${celebration.k} QUBITS ENTANGLED!`
        : 'ENTANGLEMENT!';
    setBanner({ text, kind: celebration.kind, token: celebration.token });
    setBannerPhase('in');

    const holdTimer = window.setTimeout(() => setBannerPhase('out'), BANNER_HOLD_MS);
    const clearTimer = window.setTimeout(() => setBanner(null), BANNER_HOLD_MS + BANNER_FADE_MS);
    return () => {
      window.clearTimeout(holdTimer);
      window.clearTimeout(clearTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [celebration?.token]);

  useEffect(() => {
    return () => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    };
  }, []);

  function canvasSize(): { w: number; h: number } {
    return { w: window.innerWidth, h: window.innerHeight };
  }

  function spawnBurst() {
    const { w, h } = canvasSize();
    const now = performance.now();
    const half = Math.ceil(MAX_PARTICLES / 2);
    const ps = particlesRef.current;
    for (let corner = 0; corner < 2; corner++) {
      const originX = corner === 0 ? 0 : w;
      const dir = corner === 0 ? 1 : -1;
      for (let i = 0; i < half && ps.length < MAX_PARTICLES; i++) {
        const speed = 700 + Math.random() * 600;
        const angle = (Math.random() * 55 + 20) * (Math.PI / 180);
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
    <div className="pk-celebrate" aria-hidden="true">
      <canvas ref={canvasRef} className="pk-celebrate__canvas" />
      {banner && (
        <div
          key={banner.token}
          className={`pk-banner pk-banner--${banner.kind} pk-banner--${bannerPhase}`}
          role="status"
        >
          {banner.text}
        </div>
      )}
    </div>
  );
}

export default Celebrations;
