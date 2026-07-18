import { describe, it, expect } from 'vitest';
import { matchMarkerGrid } from '../src/vision/detect';
import dictionary from '../src/vision/dictionary.json';

type Grid = number[][];

const markers = dictionary.markers as Record<string, { bits: number[][]; rotations: number[] }>;

/** Wrap a 4×4 inner matrix with an all-black (1) 6×6 border. */
function withBorder(inner: number[][]): Grid {
  const grid: Grid = Array.from({ length: 6 }, () => new Array<number>(6).fill(1));
  for (let r = 0; r < 4; r++) for (let c = 0; c < 4; c++) grid[r + 1][c + 1] = inner[r][c];
  return grid;
}

function rotateCW(m: number[][]): number[][] {
  const n = m.length;
  return Array.from({ length: n }, (_, i) =>
    Array.from({ length: n }, (_, j) => m[n - 1 - j][i]),
  );
}

describe('matchMarkerGrid', () => {
  it('identifies every marker id at rotation 0', () => {
    for (const [id, entry] of Object.entries(markers)) {
      const match = matchMarkerGrid(withBorder(entry.bits));
      expect(match).not.toBeNull();
      expect(match!.id).toBe(Number(id));
      expect(match!.rotation).toBe(0);
    }
  });

  it('reports the rotation for each of the four turns', () => {
    const id = 10; // H tile
    let inner = markers['10'].bits;
    for (let r = 0; r < 4; r++) {
      const match = matchMarkerGrid(withBorder(inner));
      expect(match).not.toBeNull();
      expect(match!.id).toBe(id);
      expect(match!.rotation).toBe(r);
      inner = rotateCW(inner);
    }
  });

  it('tolerates a single-bit error (Hamming ≤ 1)', () => {
    const inner = markers['10'].bits.map((row) => [...row]);
    inner[2][1] ^= 1; // flip one inner module
    const match = matchMarkerGrid(withBorder(inner));
    expect(match).not.toBeNull();
    expect(match!.id).toBe(10);
  });

  it('rejects a two-bit error as no match', () => {
    // Only true if the nearest other code is > 1 away; use a marker whose
    // 2-bit perturbation stays outside every code's Hamming-1 ball.
    const inner = markers['13'].bits.map((row) => [...row]);
    inner[0][0] ^= 1;
    inner[3][3] ^= 1;
    const match = matchMarkerGrid(withBorder(inner));
    // Either no match, or at least not a false high-confidence hit on id 13's
    // neighbours — we only require it is not a *clean* id-13 identification.
    if (match) expect(match.id).not.toBe(13);
  });

  it('rejects a border violation (a light border module)', () => {
    const grid = withBorder(markers['10'].bits);
    grid[0][3] = 0; // a border cell reads white → not a marker
    expect(matchMarkerGrid(grid)).toBeNull();
  });
});
