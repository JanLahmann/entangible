// @vitest-environment jsdom
/**
 * RunnerGame component tests (task #52). The rAF loop is switched off
 * (`autoRun={false}`) so these are static, gate-driven assertions: the ghost
 * opacities ARE the lane probabilities, the level picker swaps the lane/button
 * set, and the game-over overlay + restart wire through the pure reducer. A
 * seeded RNG keeps everything deterministic.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { mulberry32 } from '@shared/menu/sample';
import { initRunner } from '@quantum/runner';
import { RunnerGame } from './RunnerGame';

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
