/**
 * Camera-free integration: decode the `bell-sequence` PNG recording (rendered by
 * tests/utils/make_recording.py from assets.toml geometry) and run the full TS
 * pipeline, exactly as the browser would per frame. Asserts the empty → H → Bell
 * progression and that the 3-frame hand occlusion (frames 39-41) causes NO
 * circuit change — the same property the Python pipeline test guards.
 */
import { describe, it, expect, beforeAll } from 'vitest';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { PNG } from 'pngjs';
import { PocketPipeline } from '../src/vision/pipeline';
import type { RgbaImage } from '../src/vision/detect';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../..');
const RECORDING = resolve(REPO_ROOT, 'tests/fixtures/recordings/bell-sequence');

function loadFrames(): RgbaImage[] {
  if (!existsSync(RECORDING) || readdirSync(RECORDING).filter((f) => f.endsWith('.png')).length === 0) {
    // Regenerate the disposable fixture on demand (it is git-ignored).
    execFileSync('uv', ['run', 'python', 'tests/utils/make_recording.py'], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    });
  }
  const files = readdirSync(RECORDING)
    .filter((f) => /^frame_\d+\.png$/.test(f))
    .sort();
  return files.map((f) => {
    const png = PNG.sync.read(readFileSync(resolve(RECORDING, f)));
    return { data: new Uint8Array(png.data), width: png.width, height: png.height };
  });
}

describe('bell-sequence full pipeline (no camera)', () => {
  let frames: RgbaImage[];
  let emissions: Array<{ frame: number; circuit: unknown }>;
  let perFrame: Array<{ changed: boolean; boardFound: boolean; nGates: number }>;

  beforeAll(() => {
    frames = loadFrames();
    const pipe = new PocketPipeline();
    emissions = [];
    perFrame = [];
    frames.forEach((frame, i) => {
      const r = pipe.processFrame(frame);
      if (r.changed) emissions.push({ frame: i, circuit: r.circuit });
      perFrame.push({ changed: r.changed, boardFound: r.boardFound, nGates: r.circuit.gates.length });
    });
  }, 60_000);

  it('decodes the 48-frame recording', () => {
    expect(frames.length).toBe(48);
  });

  it('locks the board (all four corners) on the very first frame', () => {
    expect(perFrame[0].boardFound).toBe(true);
  });

  it('progresses empty → single-H → Bell', () => {
    const gateCounts = emissions.map((e) => (e.circuit as { gates: unknown[] }).gates.length);
    // First emission is the empty board, then 1 gate (H), then 2 gates (Bell).
    expect(gateCounts).toEqual([0, 1, 2]);
  });

  it('ends on the Bell golden circuit', () => {
    const bell = JSON.parse(
      readFileSync(resolve(REPO_ROOT, 'tests/fixtures/circuits/bell.json'), 'utf-8'),
    );
    expect(emissions[emissions.length - 1].circuit).toEqual(bell);
  });

  it('single-H appears only after the 5-of-7 debounce (not on frame 12)', () => {
    const hEmission = emissions.find(
      (e) => (e.circuit as { gates: unknown[] }).gates.length === 1,
    )!;
    // H tile first present at frame 12; stable at frame 16 (the 5th present frame).
    expect(hEmission.frame).toBe(16);
  });

  it('does not change the circuit across the hand occlusion (frames 39-41)', () => {
    for (let i = 36; i < 48; i++) {
      expect(perFrame[i].changed).toBe(false);
    }
    // The Bell circuit was locked before the occlusion window began.
    expect(emissions[emissions.length - 1].frame).toBeLessThan(36);
  });
});
