// @vitest-environment jsdom
/**
 * RunnerGame component tests (task #52). The rAF loop is switched off
 * (`autoRun={false}`) so these are static, gate-driven assertions: the ghost
 * opacities ARE the lane probabilities, the level picker swaps the lane/button
 * set, and the game-over overlay + restart wire through the pure reducer. A
 * seeded RNG keeps everything deterministic.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import { mulberry32 } from '@shared/menu/sample';
import { initRunner } from '@quantum/runner';
import { LangProvider } from '@shared/i18n';
import { RunnerGame, laneSummary } from './RunnerGame';
import { RUNNER_BEST_KEY } from './runnerBest';

afterEach(cleanup);

/** Read a ghost's rendered probability by lane index. */
function ghostProb(lane: number): number {
  const el = document.querySelector(`.pk-runner-ghost[data-lane="${lane}"]`);
  return Number(el?.getAttribute('data-prob'));
}

describe('RunnerGame', () => {
  it('starts at level 1 in |0⟩ — full ghost on lane 0, empty on lane 1', () => {
    render(<RunnerGame autoRun={false} rng={mulberry32(1)} />);
    expect(screen.getByText('X₀')).toBeTruthy();
    expect(screen.getByText('H₀')).toBeTruthy();
    expect(ghostProb(0)).toBeCloseTo(1, 3);
    expect(ghostProb(1)).toBeCloseTo(0, 3);
  });

  it('tapping H₀ spreads the ghost to an equal superposition', () => {
    render(<RunnerGame autoRun={false} rng={mulberry32(1)} />);
    fireEvent.click(screen.getByText('H₀'));
    expect(ghostProb(0)).toBeCloseTo(0.5, 3);
    expect(ghostProb(1)).toBeCloseTo(0.5, 3);
  });

  it('level 2 exposes the full button row and builds a safe Bell state', () => {
    render(<RunnerGame autoRun={false} rng={mulberry32(1)} />);
    fireEvent.click(screen.getByRole('button', { name: '2 qubits' }));
    // Full level-2 gate row.
    for (const label of ['X₀', 'X₁', 'H₀', 'H₁', 'CX 0→1', 'CX 1→0']) {
      expect(screen.getByText(label)).toBeTruthy();
    }
    // H₀ then CX 0→1 → Φ⁺: mass only on |00⟩ (lane 0) and |11⟩ (lane 3).
    fireEvent.click(screen.getByText('H₀'));
    fireEvent.click(screen.getByText('CX 0→1'));
    expect(ghostProb(0)).toBeCloseTo(0.5, 3);
    expect(ghostProb(1)).toBeCloseTo(0, 3);
    expect(ghostProb(2)).toBeCloseTo(0, 3);
    expect(ghostProb(3)).toBeCloseTo(0.5, 3);
  });

  it('lays the gates out per mode: X₀ H₀ (1 qubit); X₀ H₀ CX 0→1 / X₁ H₁ CX 1→0 (2 qubits)', () => {
    const gates = () =>
      Array.from(document.querySelectorAll('.pk-runner-gates .pk-runner-gate')).map((b) => [
        b.textContent,
        b.getAttribute('aria-label'),
      ]);
    const grid = () => document.querySelector('.pk-runner-gates') as HTMLElement;
    render(<RunnerGame autoRun={false} rng={mulberry32(1)} storage={null} />);
    expect(gates()).toEqual([
      ['X₀', 'Apply X to qubit 0'],
      ['H₀', 'Apply H to qubit 0'],
    ]);
    expect(grid().dataset.cols).toBe('2');
    expect(grid().style.getPropertyValue('--gate-cols')).toBe('2');
    fireEvent.click(screen.getByRole('button', { name: '2 qubits' }));
    expect(gates()).toEqual([
      ['X₀', 'Apply X to qubit 0'],
      ['H₀', 'Apply H to qubit 0'],
      ['CX 0→1', 'Apply CX, control qubit 0, target qubit 1'],
      ['X₁', 'Apply X to qubit 1'],
      ['H₁', 'Apply H to qubit 1'],
      ['CX 1→0', 'Apply CX, control qubit 1, target qubit 0'],
    ]);
    expect(grid().dataset.cols).toBe('3');
    expect(document.querySelector('.pk-runner')!.getAttribute('data-level')).toBe('2');
  });

  it('Reset puts a superposition / Bell state back to |0⟩ / |00⟩ and keeps score and lives', () => {
    render(<RunnerGame autoRun={false} rng={mulberry32(1)} storage={null} />);
    const reset1 = screen.getByRole('button', { name: 'Reset the qubit to 0' });
    expect(reset1.textContent).toBe('Reset |0⟩');
    fireEvent.click(screen.getByText('H₀'));
    expect(ghostProb(1)).toBeCloseTo(0.5, 3);
    fireEvent.click(reset1);
    expect(ghostProb(0)).toBeCloseTo(1, 3);
    expect(ghostProb(1)).toBeCloseTo(0, 3);

    fireEvent.click(screen.getByRole('button', { name: '2 qubits' }));
    fireEvent.click(screen.getByText('H₀'));
    fireEvent.click(screen.getByText('CX 0→1'));
    expect(ghostProb(3)).toBeCloseTo(0.5, 3);
    const reset2 = screen.getByRole('button', { name: 'Reset all qubits to 0' });
    expect(reset2.textContent).toBe('Reset |00⟩');
    fireEvent.click(reset2);
    expect([0, 1, 2, 3].map(ghostProb)).toEqual([1, 0, 0, 0]);
    expect(screen.getByText('0.0')).toBeTruthy();
    expect(screen.getByRole('img', { name: '3 lives' })).toBeTruthy();
  });

  it('Reset sits in the HUD, not among the gates', () => {
    render(<RunnerGame autoRun={false} rng={mulberry32(1)} storage={null} />);
    const reset = screen.getByRole('button', { name: 'Reset the qubit to 0' });
    expect(reset.closest('.pk-runner-hud')).not.toBeNull();
    expect(reset.closest('.pk-runner-gates')).toBeNull();
    // Directly before pause.
    expect(reset.nextElementSibling?.classList.contains('pk-runner-pause')).toBe(true);
  });

  it('shows the game-over overlay with score + distance and restarts', () => {
    const over = { ...initRunner(1), status: 'over' as const, lives: 0, score: 4.2, distance: 5 };
    render(<RunnerGame autoRun={false} rng={mulberry32(1)} initialState={over} />);
    expect(screen.getByText('Measurement got you')).toBeTruthy();
    // Score (4.2) shows in both the HUD and the over-card; distance (5 × 9 = 45 m)
    // is unique to the over-card.
    expect(screen.getAllByText('4.2').length).toBeGreaterThanOrEqual(1);
    expect(screen.getByText('45 m')).toBeTruthy();
    // Restart clears the overlay (fresh playing run).
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    expect(screen.queryByText('Measurement got you')).toBeNull();
    // Gate buttons are enabled again in the fresh run.
    expect((screen.getByText('H₀') as HTMLButtonElement).disabled).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Pause, announcements, injected game events, best score (runner bundle work,
// docs/runner-bundle.md — all of it lives in RunnerGame, so the site has it too)
// ---------------------------------------------------------------------------

/** Fake clocks incl. rAF + performance, so the real tick loop runs under control. */
function fakeClock() {
  vi.useFakeTimers({
    toFake: [
      'setTimeout',
      'clearTimeout',
      'setInterval',
      'clearInterval',
      'Date',
      'requestAnimationFrame',
      'cancelAnimationFrame',
      'performance',
    ],
  });
}

const elapsed = () => Number(document.querySelector('.pk-runner')!.getAttribute('data-elapsed'));
const holdOf = () => document.querySelector('.pk-runner')!.getAttribute('data-hold');
const spoken = () => (document.querySelector('.pk-runner-sr')!.textContent ?? '').trim();

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
  document.dispatchEvent(new Event('visibilitychange'));
}

const H = { re: Math.SQRT1_2, im: 0 };
const Z = { re: 0, im: 0 };
const ONE = { re: 1, im: 0 };

/** A level-1 run with hand-placed columns and no spawns. */
function staged(
  columns: Array<{ kind: 'coin' | 'obstacle'; lanes: number[]; x: number }>,
  amps = [H, H],
  lives = 3,
) {
  const base = initRunner(1);
  return {
    ...base,
    amps,
    lives,
    spawnCooldown: 1000,
    columns: columns.map((c, i) => ({ ...c, id: i, resolved: false })),
    nextColumnId: columns.length,
  };
}

function memStorage() {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
}

describe('RunnerGame — pause', () => {
  afterEach(() => {
    vi.useRealTimers();
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
  });

  it('stops the loop when the page is hidden and resumes only via Resume + countdown', () => {
    fakeClock();
    render(<RunnerGame rng={mulberry32(1)} storage={null} />);
    act(() => void vi.advanceTimersByTime(1000));
    const e1 = elapsed();
    expect(e1).toBeGreaterThan(0.5);

    act(() => setHidden(true));
    expect(holdOf()).toBe('paused');
    const e2 = elapsed();
    act(() => void vi.advanceTimersByTime(5000));
    expect(elapsed()).toBe(e2);

    // Coming back does not resume by itself.
    act(() => setHidden(false));
    act(() => void vi.advanceTimersByTime(2000));
    expect(elapsed()).toBe(e2);
    expect(holdOf()).toBe('paused');
    expect((screen.getByText('H₀') as HTMLButtonElement).disabled).toBe(true);

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    expect(holdOf()).toBe('countdown');
    expect(spoken()).toBe('3');
    act(() => void vi.advanceTimersByTime(1000));
    expect(spoken()).toBe('2');
    expect(elapsed()).toBe(e2); // still held while counting down
    act(() => void vi.advanceTimersByTime(2000));
    expect(holdOf()).toBe('run');
    expect(spoken()).toBe('Go!');
    act(() => void vi.advanceTimersByTime(500));
    expect(elapsed()).toBeGreaterThan(e2);
  });

  it('also pauses on window blur, on pagehide and on the pause button', () => {
    fakeClock();
    render(<RunnerGame rng={mulberry32(1)} storage={null} />);
    act(() => void window.dispatchEvent(new Event('blur')));
    expect(holdOf()).toBe('paused');
    expect(spoken()).toBe('Paused.');

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    act(() => void vi.advanceTimersByTime(3000));
    expect(holdOf()).toBe('run');
    act(() => void window.dispatchEvent(new Event('pagehide')));
    expect(holdOf()).toBe('paused');

    fireEvent.click(screen.getByRole('button', { name: 'Resume' }));
    act(() => void vi.advanceTimersByTime(3000));
    fireEvent.click(screen.getByRole('button', { name: 'Pause the run' }));
    expect(holdOf()).toBe('paused');
  });

  it('holds while suspended (a sheet over the game)', () => {
    fakeClock();
    const { rerender } = render(<RunnerGame rng={mulberry32(1)} storage={null} />);
    rerender(<RunnerGame rng={mulberry32(1)} storage={null} suspended />);
    const e = elapsed();
    act(() => void vi.advanceTimersByTime(2000));
    expect(elapsed()).toBe(e);
    rerender(<RunnerGame rng={mulberry32(1)} storage={null} />);
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });
});

describe('RunnerGame — VoiceOver', () => {
  afterEach(() => vi.useRealTimers());

  it('names every gate button', () => {
    render(<RunnerGame autoRun={false} rng={mulberry32(1)} storage={null} initialLevel={2} />);
    for (const name of [
      'Apply X to qubit 0',
      'Apply X to qubit 1',
      'Apply H to qubit 0',
      'Apply H to qubit 1',
      'Apply CX, control qubit 0, target qubit 1',
      'Apply CX, control qubit 1, target qubit 0',
    ]) {
      expect(screen.getByRole('button', { name })).toBeTruthy();
    }
  });

  it('announces each event with lane probabilities, lives and score — throttled, latest wins', () => {
    fakeClock();
    // Three coins crossing ~0.2 s apart: only the first and the LAST are spoken.
    const s = staged([
      { kind: 'coin', lanes: [0, 1], x: 0.001 },
      { kind: 'coin', lanes: [0], x: 0.04 },
      { kind: 'coin', lanes: [1], x: 0.08 },
    ]);
    render(<RunnerGame rng={mulberry32(1)} storage={null} initialState={s} />);
    const seen: string[] = [];
    for (let i = 0; i < 60; i++) {
      act(() => void vi.advanceTimersByTime(50));
      if (spoken() && seen[seen.length - 1] !== spoken()) seen.push(spoken());
    }
    expect(seen).toEqual([
      'Coin, plus 1.0. |0⟩ 50%, |1⟩ 50%. 3 lives, score 1.0.',
      'Coin, plus 0.5. |0⟩ 50%, |1⟩ 50%. 3 lives, score 2.0.',
    ]);
  });

  it('announces game over at once, then the new run', () => {
    fakeClock();
    // A certain hit (|0⟩ into an obstacle on lane 0) on the last life.
    const s = staged([{ kind: 'obstacle', lanes: [0], x: 0.001 }], [ONE, Z], 1);
    render(<RunnerGame rng={mulberry32(1)} storage={null} initialState={s} />);
    act(() => void vi.advanceTimersByTime(100));
    expect(screen.getByText('Measurement got you')).toBeTruthy();
    expect(spoken()).toBe('Game over. Score 0.0, distance 0 m. Run again is ready.');
    fireEvent.click(screen.getByRole('button', { name: 'Run again' }));
    expect(spoken()).toBe('New run, 1 qubit.');
  });

  it('speaks German too', () => {
    fakeClock();
    const s = staged([{ kind: 'coin', lanes: [0, 1], x: 0.001 }]);
    render(
      <LangProvider lang="de">
        <RunnerGame rng={mulberry32(1)} storage={null} initialState={s} />
      </LangProvider>,
    );
    act(() => void vi.advanceTimersByTime(100));
    expect(spoken()).toBe('Münze, plus 1.0. |0⟩ 50%, |1⟩ 50%. 3 Leben, 1.0 Punkte.');
    expect(screen.getByRole('button', { name: 'H auf Qubit 0 anwenden' })).toBeTruthy();
  });

  it('announces a reset with the new lane probabilities (EN and DE)', () => {
    fakeClock();
    const { unmount } = render(<RunnerGame rng={mulberry32(1)} storage={null} initialLevel={2} />);
    fireEvent.click(screen.getByText('H₀'));
    fireEvent.click(screen.getByRole('button', { name: 'Reset all qubits to 0' }));
    expect(spoken()).toBe('Reset. |00⟩ 100%.');
    unmount();
    render(
      <LangProvider lang="de">
        <RunnerGame rng={mulberry32(1)} storage={null} />
      </LangProvider>,
    );
    const btn = screen.getByRole('button', { name: 'Qubit auf 0 zurücksetzen' });
    expect(btn.textContent).toBe('Zurück auf |0⟩');
    fireEvent.click(btn);
    expect(spoken()).toBe('Zurückgesetzt. |0⟩ 100%.');
  });

  it('names the 2-qubit reset in German too', () => {
    render(
      <LangProvider lang="de">
        <RunnerGame autoRun={false} rng={mulberry32(1)} storage={null} initialLevel={2} />
      </LangProvider>,
    );
    expect(screen.getByRole('button', { name: 'Alle Qubits auf 0 zurücksetzen' }).textContent).toBe(
      'Zurück auf |00⟩',
    );
  });

  it('Reset is disabled while the run is held', () => {
    render(<RunnerGame autoRun={false} rng={mulberry32(1)} storage={null} startPaused />);
    expect((screen.getByRole('button', { name: 'Reset the qubit to 0' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('summarises lanes without the empty ones', () => {
    expect(laneSummary(2, [0.5, 0, 0, 0.5])).toBe('|00⟩ 50%, |11⟩ 50%');
    expect(laneSummary(1, [1, 0])).toBe('|0⟩ 100%');
  });
});

describe('RunnerGame — game events and best score', () => {
  afterEach(() => vi.useRealTimers());

  const coinThenHit = () =>
    staged(
      [
        { kind: 'coin', lanes: [0], x: 0.001 },
        { kind: 'obstacle', lanes: [0], x: 0.02 },
      ],
      [ONE, Z],
      1,
    );

  it('reports start / finish to onEvent when given one (the site passes trackGame)', () => {
    fakeClock();
    const onEvent = vi.fn();
    render(<RunnerGame rng={mulberry32(1)} storage={null} initialState={coinThenHit()} onEvent={onEvent} />);
    expect(onEvent).toHaveBeenCalledWith('runner start', { level: 1 });
    act(() => void vi.advanceTimersByTime(1000));
    expect(onEvent).toHaveBeenLastCalledWith('runner finish', { level: 1, score: 1 });
  });

  it('plays a whole run without onEvent (the bundle) and keeps the best score', () => {
    fakeClock();
    const storage = memStorage();
    render(<RunnerGame rng={mulberry32(1)} storage={storage} initialState={coinThenHit()} />);
    act(() => void vi.advanceTimersByTime(1000));
    expect(screen.getByText('Measurement got you')).toBeTruthy();
    expect(screen.getByText('New best!')).toBeTruthy();
    expect(JSON.parse(storage.getItem(RUNNER_BEST_KEY)!)).toEqual({ 1: 1 });
    expect(spoken()).toMatch(/^Game over\. Score 1\.0, .* New best!$/);
  });

  it('keeps the gate grid and reset rules in the shared stylesheet', () => {
    const dir = dirname(fileURLToPath(import.meta.url));
    const css = readFileSync(join(dir, 'runnerGame.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const body = (sel: string) => {
      const at = css.indexOf(`\n${sel} {`);
      expect(at, sel).toBeGreaterThan(-1);
      return css.slice(css.indexOf('{', at) + 1, css.indexOf('}', at));
    };
    expect(body('.pk-runner-gates')).toContain('display: grid');
    expect(body('.pk-runner-gates')).toContain('grid-template-columns: repeat(var(--gate-cols, 2), minmax(0, 1fr))');
    const gate = body('.pk-runner-gate');
    expect(gate).toContain('min-height: 44px');
    expect(gate).toContain('white-space: nowrap');
    const reset = body('.pk-runner-reset');
    expect(reset).toContain('min-height: 44px');
    expect(reset).toContain('min-width: 44px');
    expect(reset).toContain('margin-left: auto');
    // Short landscape: the gates move beside the field.
    expect(css).toMatch(/@media \(orientation: landscape\) and \(max-height: 450px\) and \(min-width: 600px\) \{[\s\S]*?\.pk-runner-gates \{[^}]*grid-column: 2;/);
  });

  it('imports no analytics module (the bundle must not carry one)', () => {
    const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'RunnerGame.tsx'), 'utf8');
    expect(src).not.toMatch(/from\s+['"]\.\/analytics['"]/);
  });
});
