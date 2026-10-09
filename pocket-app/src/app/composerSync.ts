/**
 * "Composer live-sync" — continuously mirror the physical circuit into a REAL
 * IBM Quantum Composer browser tab (Task 36, sibling of composerTransfer.ts).
 *
 * Where the Transfer button is a one-shot handoff, live-sync keeps a single
 * Composer tab following the table: place a tile, and a couple of seconds later
 * the open Composer reloads with the new circuit pre-filled via the SAME
 * verified `?initial=` URL (see composerTransfer.ts for the format — this module
 * only decides *when* to (re)navigate, it reuses `composerUrl` for the *what*).
 *
 * THE NAMED-TARGET TRICK (why this works without a WindowProxy handle):
 *   `window.open(url, 'entangible-composer')` — a NAMED second argument — asks
 *   the browser to reuse the tab that already carries that name. Calling it
 *   again with a fresh URL RE-NAVIGATES that same tab; we never hold or poll a
 *   window handle (which would go stale, break across our own reloads, and is
 *   blocked by cross-origin rules anyway). One caveat drives a deliberate
 *   omission below: passing `noopener` makes the browser open a brand-new tab
 *   every time (and returns null), defeating reuse — so the live-sync open, and
 *   ONLY it, omits `noopener`. The first open must still happen inside a user
 *   gesture (popup blockers) — that's the caller's `start()` on the toggle click.
 *
 * Pure + injectable (open / clock / timers) so the debounce + min-interval
 * choreography is unit-testable with fake timers and no real DOM.
 */
import { COMPOSER_BASE, composerUrl } from './composerTransfer';
import { en } from '@shared/i18n/en';

/** The named tab reused across navigations (see the header's named-target note). */
export const COMPOSER_SYNC_TARGET = 'entangible-composer';

/**
 * Stability window: a person mid-build shouldn't trigger reloads, so we wait
 * this long after the LAST circuit change before navigating.
 */
export const SYNC_DEBOUNCE_MS = 2000;

/** Floor between two navigations, so a burst of edits can't hammer the tab. */
export const SYNC_MIN_INTERVAL_MS = 3000;

/** Toast shown when live-sync is switched on (first, gesture-driven, open). */
export const SYNC_ENABLED_MESSAGE = en.composer.syncEnabled;

type TimerHandle = ReturnType<typeof setTimeout>;

/** Injectable environment so the choreography runs headless in tests. */
export interface ComposerSyncEnv {
  /** Navigate the named tab. Deliberately no `noopener` (see the header). */
  open: (url: string, target: string) => void;
  now: () => number;
  setTimer: (fn: () => void, ms: number) => TimerHandle;
  clearTimer: (handle: TimerHandle) => void;
}

function defaultEnv(): ComposerSyncEnv {
  return {
    open: (url, target) => {
      if (typeof window !== 'undefined') window.open(url, target);
    },
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: (handle) => clearTimeout(handle),
  };
}

/**
 * A live-sync session for one Composer tab. Identity of a circuit is its QASM
 * string; an EMPTY circuit is represented by the caller passing `''` (so an
 * empty board syncs the bare Composer on the gesture-open but never navigates
 * on its own afterwards).
 */
export class ComposerSync {
  private readonly env: ComposerSyncEnv;
  private active = false;
  /** QASM last actually navigated to (the tab's current known content). */
  private syncedQasm: string | null = null;
  /** QASM of the newest change awaiting the debounce/min-interval gates. */
  private pendingQasm = '';
  private timer: TimerHandle | null = null;
  private lastNavAt = 0;

  constructor(env: ComposerSyncEnv = defaultEnv()) {
    this.env = env;
  }

  get isActive(): boolean {
    return this.active;
  }

  /**
   * Turn live-sync ON. MUST be called from a user gesture (the toggle click) so
   * the first `window.open` clears popup blockers. Opens the tab immediately
   * with the current circuit (or the bare Composer when empty) and adopts it as
   * the synced baseline; later `update()`s drive the follow-along navigations.
   */
  start(qasm: string): void {
    this.active = true;
    this.pendingQasm = qasm;
    this.navigate(qasm);
  }

  /**
   * Feed a circuit-change event (the new QASM, or `''` for an empty board).
   * No-ops while inactive. Otherwise (re)arms the stability debounce; when it
   * settles the min-interval gate decides navigate-now vs. wait-a-little-more.
   */
  update(qasm: string): void {
    if (!this.active) return;
    this.pendingQasm = qasm;
    this.clearTimer();
    // Nothing to do if the tab already shows exactly this circuit.
    if (qasm === this.syncedQasm) return;
    this.arm(SYNC_DEBOUNCE_MS);
  }

  /** Turn live-sync OFF. Stops syncing; the Composer tab is left untouched. */
  stop(): void {
    this.active = false;
    this.clearTimer();
  }

  private arm(ms: number): void {
    this.timer = this.env.setTimer(() => {
      this.timer = null;
      this.onStable();
    }, ms);
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      this.env.clearTimer(this.timer);
      this.timer = null;
    }
  }

  private onStable(): void {
    if (!this.active) return;
    const qasm = this.pendingQasm;
    // Skip empty circuits and no-op repeats.
    if (qasm === '' || qasm === this.syncedQasm) return;
    // Over-long circuits fall back to the bare COMPOSER_BASE (composerTransfer's
    // 7500-char budget). Navigating there would DROP the visitor's work, so we
    // keep the last good state in the tab instead of clobbering it.
    if (composerUrl(qasm) === COMPOSER_BASE) return;
    // Min-interval gate: if we navigated recently, wait out the remainder.
    const elapsed = this.env.now() - this.lastNavAt;
    if (elapsed < SYNC_MIN_INTERVAL_MS) {
      this.arm(SYNC_MIN_INTERVAL_MS - elapsed);
      return;
    }
    this.navigate(qasm);
  }

  /** Unconditional navigate (used by start + the gated onStable path). */
  private navigate(qasm: string): void {
    const url = composerUrl(qasm);
    this.env.open(url, COMPOSER_SYNC_TARGET);
    this.syncedQasm = qasm;
    this.lastNavAt = this.env.now();
  }
}
