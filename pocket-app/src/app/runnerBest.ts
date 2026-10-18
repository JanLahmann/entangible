/**
 * Quantum Runner best score per level, shared by the site's runner mode and the
 * runner-only bundle (docs/runner.md, docs/runner-bundle.md).
 *
 * Stored under `entangible.pocket.runner.best` as `{"1": 12.3, "2": 4.5}`
 * (score with one decimal, like the HUD). Best-effort: storage that is absent,
 * blocked or full just means the best is not remembered.
 */
import type { Level } from '@quantum/runner';

export const RUNNER_BEST_KEY = 'entangible.pocket.runner.best';

export type KeyStorage = Pick<Storage, 'getItem' | 'setItem'>;

export type RunnerBests = Partial<Record<Level, number>>;

/** The page's localStorage, or null where touching it throws. */
export function defaultRunnerStorage(): KeyStorage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

export function loadRunnerBests(storage: KeyStorage | null): RunnerBests {
  try {
    const raw = storage?.getItem(RUNNER_BEST_KEY);
    if (!raw) return {};
    const r = JSON.parse(raw) as Record<string, unknown>;
    const out: RunnerBests = {};
    for (const lv of [1, 2] as Level[]) {
      const v = r[String(lv)];
      if (typeof v === 'number' && Number.isFinite(v) && v > 0) out[lv] = v;
    }
    return out;
  } catch {
    return {};
  }
}

/**
 * Record a finished run. Returns the new bests and whether this run set one
 * (a score of 0 never does).
 */
export function recordRunnerScore(
  storage: KeyStorage | null,
  level: Level,
  score: number,
): { bests: RunnerBests; isNewBest: boolean } {
  const bests = loadRunnerBests(storage);
  const rounded = Math.round(score * 10) / 10;
  const isNewBest = rounded > 0 && rounded > (bests[level] ?? 0);
  if (!isNewBest) return { bests, isNewBest };
  const next = { ...bests, [level]: rounded };
  try {
    storage?.setItem(RUNNER_BEST_KEY, JSON.stringify(next));
  } catch {
    /* storage full / blocked: the best holds for this run only */
  }
  return { bests: next, isNewBest };
}
