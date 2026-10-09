/**
 * Booth resilience — the board-loss grace (`BOARD_LOSS_GRACE_S`). The TS twin of
 * `packages/qamposer-vision/tests/test_resilience.py` (board-loss half): same
 * constant, same scripted sequences, same frame rates, same expectations.
 *
 * A board out of sight (< 3 corner blocks) is HELD — circuit, stable tiles and
 * lattice untouched — until it has been continuously missing for 2.0 s, on the
 * frame timestamps. Only then is the circuit cleared, once. Because the circuit
 * never empties during a brief occlusion, nothing downstream (celebrations,
 * golf strokes) can re-fire.
 */
import { describe, it, expect, vi } from 'vitest';
import { BOARD_LOSS_GRACE_S, PocketPipeline, type FrameResult } from '../src/vision/pipeline';
import { matBoardModel } from '../src/vision/boardModel';
import type { GrayImage } from '../src/vision/detect';
import { renderBoard } from './utils/renderBoard';

// Rendered stills are deterministic, so detect each distinct frame once (the
// Python twin's `_ScriptedDetector` does the same) — hundreds of frames per
// sequence would otherwise spend the whole budget re-decoding identical pixels.
vi.mock('../src/vision/detect', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/vision/detect')>();
  const cache = new WeakMap<object, ReturnType<typeof actual.detectMarkers>>();
  return {
    ...actual,
    detectMarkers: (...args: Parameters<typeof actual.detectMarkers>) => {
      const key = args[0].data;
      let hit = cache.get(key);
      if (!hit) {
        hit = actual.detectMarkers(...args);
        cache.set(key, hit);
      }
      return hit;
    },
  };
});

const BELL: Array<[number, number, number]> = [
  [30, 0, 0],
  [17, 0, 1],
  [15, 1, 1],
];
const MODEL = matBoardModel();
const bell = renderBoard(MODEL, BELL, [], 2.0);
// The same tiles, but a visitor's arm hides three corner blocks.
const occluded = renderBoard(MODEL, BELL, [], 2.0, { corners: [0] });
const empty = renderBoard(MODEL, [], [], 2.0);
const emptyGone = renderBoard(MODEL, [], [], 2.0, { corners: [0] });

/** Drive one pipeline through a scripted, timestamped frame sequence. */
class Run {
  i = 0; // frame index; t = i / fps (no accumulated float drift)
  readonly pipe = new PocketPipeline();
  readonly emissions: Array<{ t: number; circuit: FrameResult['circuit'] }> = [];
  readonly results: FrameResult[] = [];
  constructor(readonly fps: number) {}

  get now(): number {
    return this.i / this.fps;
  }

  feed(frame: GrayImage): FrameResult {
    const r = this.pipe.processFrame(frame, (this.i * 1000) / this.fps);
    if (r.changed) this.emissions.push({ t: this.now, circuit: r.circuit });
    this.results.push(r);
    this.i += 1;
    return r;
  }

  /** Feed `frame` while elapsed < `seconds`; returns the first frame's time. */
  feedFor(frame: GrayImage, seconds: number): number {
    const start = this.now;
    while (this.now - start < seconds) this.feed(frame);
    return start;
  }
}

function gates(circuit: FrameResult['circuit']): Array<[string, number]> {
  return circuit.gates
    .map((g) => [g.type, g.position] as [string, number])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] - b[1]));
}

describe('board-loss grace', () => {
  it('pins the shared constant', () => {
    expect(BOARD_LOSS_GRACE_S).toBe(2.0); // same number as pipeline.py
  });

  it.each([4, 30, 128])('holds the circuit through 1.9 s of lost corners at %i fps', (fps) => {
    const run = new Run(fps);
    for (let k = 0; k < 10; k++) run.feed(bell);
    expect(run.emissions.map((e) => gates(e.circuit))).toEqual([
      [],
      [
        ['CNOT', 1],
        ['H', 0],
      ],
    ]);
    const rowsBefore = run.results[run.results.length - 1].model.rows;
    const nEmissions = run.emissions.length;
    const nResults = run.results.length;

    run.feedFor(occluded, 1.9);
    const held = run.results.slice(nResults);
    expect(held.length).toBeGreaterThan(0);
    for (const r of held) {
      expect(r.boardFound).toBe(false);
      expect(r.corners).toBeLessThan(3);
      expect(r.changed).toBe(false);
      expect(r.model.rows).toBe(rowsBefore); // lattice held too
      expect(gates(r.circuit)).toEqual([
        ['CNOT', 1],
        ['H', 0],
      ]);
    }

    for (let k = 0; k < 10; k++) run.feed(bell);
    expect(run.emissions.length).toBe(nEmissions); // no change, no re-emission
    expect(run.results[run.results.length - 1].boardFound).toBe(true);
  });

  it.each([4, 30, 128])('clears once when the corners stay gone 2.1 s at %i fps', (fps) => {
    const run = new Run(fps);
    for (let k = 0; k < 10; k++) run.feed(bell);
    const nEmissions = run.emissions.length;

    const firstMissing = run.feedFor(occluded, 2.1);
    expect(run.emissions.length).toBe(nEmissions + 1); // exactly one clear
    const cleared = run.emissions[run.emissions.length - 1];
    expect(cleared.circuit.gates).toEqual([]);
    const elapsed = cleared.t - firstMissing;
    expect(elapsed).toBeGreaterThanOrEqual(BOARD_LOSS_GRACE_S);
    expect(elapsed).toBeLessThan(BOARD_LOSS_GRACE_S + 1 / fps + 1e-9);

    // Back with the same tiles: re-appears through the normal debounce.
    for (let k = 0; k < 10; k++) run.feed(bell);
    expect(run.emissions.length).toBe(nEmissions + 2);
    expect(gates(run.emissions[run.emissions.length - 1].circuit)).toEqual([
      ['CNOT', 1],
      ['H', 0],
    ]);
  });

  it('restarts the clock when the board flickers back', () => {
    const run = new Run(30);
    for (let k = 0; k < 10; k++) run.feed(bell);
    const n = run.emissions.length;
    run.feedFor(occluded, 1.5);
    run.feed(bell);
    run.feedFor(occluded, 1.5);
    for (let k = 0; k < 5; k++) run.feed(bell);
    expect(run.emissions.length).toBe(n);
  });

  it('emits nothing when an already-empty board is lost', () => {
    const run = new Run(30);
    for (let k = 0; k < 10; k++) run.feed(empty);
    const n = run.emissions.length;
    run.feedFor(emptyGone, 3.0);
    expect(run.emissions.length).toBe(n);
  });
});
