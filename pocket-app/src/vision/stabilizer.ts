/**
 * Temporal stabilization — asymmetric hysteresis so hands don't cause flicker.
 * Exact port of `stabilizer.py`.
 *
 * A tile *appears* only after it is present in ≥ `appearMin` of the last
 * `appearWindow` frames (default 5 of 7); it *disappears* only after
 * `disappearAfter` consecutive absent frames (default 12). `update()` returns
 * the stable set plus a `changed` flag that is true only on frames where the
 * stable set actually gained or lost a tile.
 */

/**
 * A grid-resolved tile observation `(markerId, row, col, rotation)`, packed as a
 * string key. `rotation` is the board-frame 90° step (0-3); it is 0 for every
 * orientation-free tile and only varies for dial tiles, whose angle is chosen by
 * how they are turned — so turning a dial in place changes the key (a real
 * change under the same hysteresis) while a within-quadrant wiggle keeps it.
 */
export type Tile = string;

export function tileKey(markerId: number, row: number, col: number, rotation = 0): Tile {
  return `${markerId},${row},${col},${rotation}`;
}

export function parseTile(tile: Tile): [number, number, number, number] {
  const [m, r, c, rot] = tile.split(',').map(Number);
  return [m, r, c, rot];
}

export interface StabilizerResult {
  readonly stable: ReadonlySet<Tile>;
  readonly changed: boolean;
  readonly added: ReadonlySet<Tile>;
  readonly removed: ReadonlySet<Tile>;
}

export class TileStabilizer {
  private readonly window: Array<Set<Tile>> = [];
  private readonly absent = new Map<Tile, number>();
  private readonly stableSet = new Set<Tile>();

  constructor(
    private readonly appearWindow = 7,
    private readonly appearMin = 5,
    private readonly disappearAfter = 12,
  ) {
    if (appearMin > appearWindow) {
      throw new Error('appearMin cannot exceed appearWindow');
    }
  }

  get stable(): ReadonlySet<Tile> {
    return new Set(this.stableSet);
  }

  reset(): void {
    this.window.length = 0;
    this.absent.clear();
    this.stableSet.clear();
  }

  update(observed: Iterable<Tile>): StabilizerResult {
    const obs = new Set(observed);
    this.window.push(obs);
    if (this.window.length > this.appearWindow) this.window.shift();

    const removed = new Set<Tile>();
    const added = new Set<Tile>();

    // Disappearance: only after `disappearAfter` consecutive absent frames.
    for (const tile of [...this.stableSet]) {
      if (obs.has(tile)) {
        this.absent.set(tile, 0);
      } else {
        const streak = (this.absent.get(tile) ?? 0) + 1;
        this.absent.set(tile, streak);
        if (streak >= this.disappearAfter) {
          this.stableSet.delete(tile);
          this.absent.delete(tile);
          removed.add(tile);
        }
      }
    }

    // Appearance: present in ≥ appearMin of the last appearWindow frames.
    const candidates = new Set<Tile>();
    for (const frame of this.window) {
      for (const tile of frame) {
        if (!this.stableSet.has(tile)) candidates.add(tile);
      }
    }
    for (const tile of candidates) {
      let count = 0;
      for (const frame of this.window) if (frame.has(tile)) count++;
      if (count >= this.appearMin) {
        this.stableSet.add(tile);
        this.absent.set(tile, 0);
        added.add(tile);
      }
    }

    const changed = added.size > 0 || removed.size > 0;
    return { stable: new Set(this.stableSet), changed, added, removed };
  }
}
