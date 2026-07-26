/**
 * Celebrations overlay — hand-rolled canvas confetti + a scale-in banner
 * (SC2 shared). No animation libraries: one full-screen <canvas> driven by
 * requestAnimationFrame plus a CSS-animated banner. A burst fires whenever
 * `celebration.token` changes (the parent bumps the token so the same kind can
 * re-fire after a board-clear cycle).
 *
 * Serves both apps via `classPrefix` (booth `ent-`, pocket `pk-`) and two
 * budget seams that preserve the pre-SC2 per-app confetti policies exactly:
 *   - `particleBudget(kind)` — particles spawned PER burst. The booth is
 *     kind-aware (Bell 100 / GHZ 150) and honours `?lowpower` (cap 60); pocket
 *     uses a fixed cap (100, or its low-power 60), kind-independent.
 *   - `maxParticles` — the absolute ceiling on the live particle array (the
 *     booth's was a constant 150; pocket's equals its cap). Both are read
 *     through refs so a parent can change them between bursts.
 *
 * Physics (docs/booth-ux.md → Principles): bursts from the bottom corners with
 * gravity, four gate colours, 1.8 s life.
 */
import { useEffect, useRef, useState } from 'react';
import type { Celebration } from '@quantum/moments';

/** The four gate colours (H / X / Y / Z). */
const COLORS = ['#fa4d56', '#002d9c', '#9f1853', '#33b1ff'] as const;

const PARTICLE_LIFE_MS = 1800;
const GRAVITY = 1400; // px / s²

const BANNER_HOLD_MS = 2500;
const BANNER_FADE_MS = 500;

/** A celebration request. `token` must change on every distinct fire. */
export interface CelebrationRequest extends Celebration {
  readonly token: number;
  /** Optional banner text override (golf hole-in: "EAGLE!/BIRDIE!/…"). */
  readonly banner?: string;
  /**
   * Multiplier on the kind's particle budget (#80) — a course finished 20 under
   * par should not look like one finished three over. Defaults to 1. The
   * `maxParticles` ceiling still applies afterwards, so low-power mode caps a
   * doubled burst exactly as it caps a normal one.
   */
  readonly intensity?: number;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  color: string;
  born: number;
}

export function Celebrations({
  celebration,
  classPrefix,
  particleBudget,
  maxParticles,
}: {
  celebration: CelebrationRequest | null;
  classPrefix: string;
  particleBudget: (kind: Celebration['kind']) => number;
  maxParticles: number;
}) {
  const p = classPrefix;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const budgetRef = useRef(particleBudget);
  budgetRef.current = particleBudget;
  const maxParticlesRef = useRef(maxParticles);
  maxParticlesRef.current = maxParticles;
  const particlesRef = useRef<Particle[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef<number>(0);

  const [banner, setBanner] = useState<{
    text: string;
    kind: Celebration['kind'];
    token: number;
  } | null>(null);
  const [bannerPhase, setBannerPhase] = useState<'in' | 'out'>('in');

  // --- confetti + banner fire on each new token -----------------------------
  useEffect(() => {
    if (!celebration) return;

    spawnBurst(celebration.kind, celebration.intensity ?? 1);
    startLoop();

    const text =
      celebration.banner ??
      (celebration.kind === 'ghz'
        ? `GHZ STATE — ${celebration.k} QUBITS ENTANGLED!`
        : 'ENTANGLEMENT!');
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

  function spawnBurst(kind: Celebration['kind'], intensity = 1) {
    const { w, h } = canvasSize();
    const budget = Math.round(budgetRef.current(kind) * intensity);
    const ceiling = maxParticlesRef.current;
    const now = performance.now();
    const half = Math.ceil(budget / 2);
    const ps = particlesRef.current;
    for (let corner = 0; corner < 2; corner++) {
      const originX = corner === 0 ? 0 : w;
      const dir = corner === 0 ? 1 : -1; // inward
      for (let i = 0; i < half && ps.length < ceiling; i++) {
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
          for (const particle of ps) {
            const age = t - particle.born;
            if (age > PARTICLE_LIFE_MS || particle.y > h + 20) continue;
            particle.vy += GRAVITY * dt;
            particle.x += particle.vx * dt;
            particle.y += particle.vy * dt;
            ctx.globalAlpha = Math.max(0, 1 - age / PARTICLE_LIFE_MS);
            ctx.fillStyle = particle.color;
            ctx.fillRect(particle.x - 4, particle.y - 4, 8, 8);
            alive.push(particle);
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
    <div className={`${p}-celebrate`} aria-hidden="true">
      <canvas ref={canvasRef} className={`${p}-celebrate__canvas`} />
      {banner && (
        <div
          key={banner.token}
          className={`${p}-banner ${p}-banner--${banner.kind} ${p}-banner--${bannerPhase}`}
          role="status"
        >
          {banner.text}
        </div>
      )}
    </div>
  );
}

export default Celebrations;
