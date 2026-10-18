// @vitest-environment jsdom
/**
 * Holing in on tap to play (#13), through the real sphere panel: `GolfBoard`
 * with `TapPlay` under it, driven like the shells (a `ManualEditSource` into
 * `useGolfGame.step`).
 *
 *   - "Next hole" takes the clubs' place in the flow; the sphere panel keeps
 *     its scrubber and goal line, and no Next hole sits in the panel.
 *   - The evolution replays once from the start; the tap grid marks the
 *     column the replay is at (aria-current="step"), and stepping with the
 *     scrubber moves the mark.
 *   - Under prefers-reduced-motion there is no auto-play: the final step shows
 *     at once, and stepping still moves the mark.
 */
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import type { Circuit } from '@qamposer/react';
import { LangProvider } from '@shared/i18n';
import { ManualEditSource } from '../sources/ManualEditSource';
import { GolfBoard } from './GolfBoard';
import { TapPlay } from './TapPlay';
import { useGolfGame, type GolfGame } from './useGolfGame';

const EMPTY: Circuit = { qubits: 5, gates: [] } as Circuit;
const live: { game: GolfGame | null } = { game: null };

function mockReducedMotion(reduce: boolean) {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    matches: reduce && query.includes('reduce'),
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  })) as unknown as typeof window.matchMedia;
}

/** A hand-cranked animation clock: frames run only when the test says so. */
const clock = { now: 0, next: 1, frames: new Map<number, FrameRequestCallback>(), requested: 0 };
function installClock() {
  clock.now = 0;
  clock.frames.clear();
  clock.requested = 0;
  vi.spyOn(performance, 'now').mockImplementation(() => clock.now);
  window.requestAnimationFrame = (cb: FrameRequestCallback) => {
    clock.requested++;
    const id = clock.next++;
    clock.frames.set(id, cb);
    return id;
  };
  window.cancelAnimationFrame = (id: number) => {
    clock.frames.delete(id);
  };
}
/** Advance the clock by `ms` in 50 ms frames. */
function run(ms: number) {
  for (let t = 0; t < ms; t += 50) {
    clock.now += 50;
    const due = [...clock.frames.values()];
    clock.frames.clear();
    act(() => due.forEach((cb) => cb(clock.now)));
  }
}

beforeEach(() => installClock());
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function Harness() {
  const sourceRef = useRef(new ManualEditSource());
  const [circuit, setCircuit] = useState<Circuit>(EMPTY);
  const game = useGolfGame({
    storage: null,
    courseCode: null,
    courseScope: null,
    setCourseCode: () => {},
    setCourseScope: () => {},
    clearBoard: () => sourceRef.current.clear(),
    circuit,
    onCelebrate: () => {},
  });
  live.game = game;
  const step = game.step;
  useEffect(() => {
    const source = sourceRef.current;
    const unsub = source.subscribe((u) => {
      setCircuit(u.circuit);
      step(u.circuit);
    });
    source.start();
    return () => {
      unsub();
      source.stop();
    };
  }, [step]);
  const onChange = (c: Circuit) => sourceRef.current.setFromEditor(c);
  return (
    <GolfBoard
      game={game}
      circuit={circuit}
      underSphere={<TapPlay game={game} circuit={circuit} onChange={onChange} />}
    />
  );
}

const tap = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));

async function holeInBell(lang: 'en' | 'de' = 'en') {
  render(
    <LangProvider lang={lang}>
      <Harness />
    </LangProvider>,
  );
  await act(async () => {});
  act(() => live.game!.jumpToHole(2));
  if (lang === 'en') {
    tap('H gate');
    tap('Qubit 0, step 1, empty: place H');
    tap('CX gate');
    tap('Qubit 0, step 2, empty: place CX control');
    tap('Qubit 1, step 2: place CX target');
  } else {
    tap('H-Gatter');
    tap('Qubit 0, Schritt 1, leer: H setzen');
    tap('CX-Gatter');
    tap('Qubit 0, Schritt 2, leer: Steuerung von CX setzen');
    tap('Qubit 1, Schritt 2: Ziel von CX setzen');
  }
  expect(live.game!.state.holedIn).toBe(true);
}

/** The circuit columns (data-col) the tap grid marks as the replay's step. */
function markedColumns(): number[] {
  const cells = Array.from(document.querySelectorAll('.pk-tapgrid-cell[aria-current="step"]'));
  for (const c of cells) expect(c.className).toContain('is-step');
  expect(document.querySelectorAll('.pk-tapgrid-cell.is-step')).toHaveLength(cells.length);
  return [...new Set(cells.map((c) => Number(c.getAttribute('data-col'))))];
}
const scrubLabel = () => document.querySelector('.pk-evo-label')!.textContent;

describe('holing in on tap to play (#13)', () => {
  it('Next hole takes the clubs’ place; the scrubber and goal line stay in the sphere panel', async () => {
    mockReducedMotion(true);
    await holeInBell();
    const bar = screen.getByRole('group', { name: 'Play by tapping' });
    const next = within(bar).getByRole('button', { name: 'Next hole ▸' });
    // In the flow, first in the bar, where the clubs were — and only there.
    expect(bar.firstElementChild).toBe(next);
    expect(next.className).toContain('pk-golf-next--bar');
    expect(bar.querySelector('.pk-gatebar-clubs')).toBeNull();
    // (The scorecard keeps its own, further down the page.)
    const hero = document.querySelector('.pk-side-hero') as HTMLElement;
    expect(within(hero).getAllByRole('button', { name: 'Next hole ▸' })).toHaveLength(1);
    const well = document.querySelector('.pk-well')!;
    expect(well.querySelector('.pk-golf-next')).toBeNull();
    expect(well.querySelector('.pk-evo-scrubber')).not.toBeNull();
    expect(well.querySelector('.pk-golf-goal')).not.toBeNull();
    for (const name of ['Replay animation', 'Previous step', 'Next step']) {
      expect(within(well as HTMLElement).getByRole('button', { name })).toBeTruthy();
    }
    // Next hole brings the clubs back and drops the mark.
    fireEvent.click(next);
    expect(live.game!.currentLevel.hole).toBe(3);
    expect(bar.querySelector('.pk-gatebar-clubs')).not.toBeNull();
    expect(markedColumns()).toEqual([]);
  });

  it('replays once from the start, marking each column; then the scrubber steps the mark', async () => {
    mockReducedMotion(false);
    await holeInBell();
    // The replay starts at the start state: nothing marked yet.
    expect(scrubLabel()).toBe('start');
    expect(markedColumns()).toEqual([]);
    run(500);
    expect(scrubLabel()).toBe('after layer 1');
    expect(markedColumns()).toEqual([0]);
    run(600);
    expect(scrubLabel()).toBe('after layer 2');
    expect(markedColumns()).toEqual([1]);
    // Once: at rest, nothing more is scheduled.
    expect(clock.frames.size).toBe(0);
    run(2000);
    expect(markedColumns()).toEqual([1]);

    tap('Previous step');
    run(600);
    expect(scrubLabel()).toBe('after layer 1');
    expect(markedColumns()).toEqual([0]);
    tap('Go to start');
    run(600);
    expect(markedColumns()).toEqual([]);
    tap('Replay animation');
    run(1100);
    expect(markedColumns()).toEqual([1]);
  });

  it('prefers-reduced-motion: no auto-play, the final step at once; stepping still works (DE)', async () => {
    mockReducedMotion(true);
    await holeInBell('de');
    expect(clock.requested).toBe(0);
    expect(scrubLabel()).toBe('nach Schicht 2');
    expect(markedColumns()).toEqual([1]);
    tap('Vorheriger Schritt');
    expect(markedColumns()).toEqual([0]);
    tap('Nächster Schritt');
    expect(markedColumns()).toEqual([1]);
    expect(clock.requested).toBe(0);
  });

  it('Next hole moves focus to the new hole’s first club, without scrolling', async () => {
    mockReducedMotion(true);
    await holeInBell();
    const focus = vi.spyOn(HTMLElement.prototype, 'focus');
    const bar = screen.getByRole('group', { name: 'Play by tapping' });
    const next = within(bar).getByRole('button', { name: 'Next hole ▸' });
    next.focus();
    fireEvent.click(next);
    expect(live.game!.currentLevel.hole).toBe(3);
    const first = bar.querySelector('.pk-gatebar-club') as HTMLButtonElement;
    expect(document.activeElement).toBe(first);
    expect(focus).toHaveBeenLastCalledWith({ preventScroll: true });
    // Once only: later renders leave focus where the player puts it.
    const grid = screen.getByRole('button', { name: 'Qubit 0, step 1, empty' });
    grid.focus();
    tap('H gate');
    expect(document.activeElement).not.toBe(first);
  });

  it('while a hole is being played, the grid marks no column', async () => {
    mockReducedMotion(true);
    render(
      <LangProvider lang="en">
        <Harness />
      </LangProvider>,
    );
    await act(async () => {});
    act(() => live.game!.jumpToHole(2));
    tap('H gate');
    tap('Qubit 0, step 1, empty: place H');
    expect(live.game!.state.holedIn).toBe(false);
    expect(markedColumns()).toEqual([]);
  });
});
