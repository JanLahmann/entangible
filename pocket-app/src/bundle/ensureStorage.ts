/**
 * Storage fallback of the app bundles (golf: docs/golf-bundle.md, runner:
 * docs/runner-bundle.md), run once before the first render.
 *
 * A web view whose storage throws (an opaque origin, storage disabled) would
 * otherwise crash on the first unguarded read (the editor library's theme read
 * in golf). Fall back to a page-lifetime memory store: the game plays, it just
 * forgets on reload.
 */
export function ensureStorage(win: Window = window): void {
  try {
    win.localStorage.getItem('entangible.bundle.probe');
  } catch {
    const mem = new Map<string, string>();
    const shim: Storage = {
      get length() {
        return mem.size;
      },
      clear: () => mem.clear(),
      getItem: (k) => mem.get(k) ?? null,
      key: (i) => [...mem.keys()][i] ?? null,
      removeItem: (k) => void mem.delete(k),
      setItem: (k, v) => void mem.set(k, String(v)),
    };
    Object.defineProperty(win, 'localStorage', { value: shim, configurable: true });
  }
}
