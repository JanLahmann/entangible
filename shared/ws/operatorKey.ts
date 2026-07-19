/**
 * Operator-key handling (staff credential) — shared by both apps (U2).
 *
 * Staff-only surfaces — the `/debug` preview + `/api/qr`, the `/ws/frames`
 * phone intake, and the `select_*` control messages on `/ws/state` — are gated
 * behind a single shared operator token (see `docs/protocol.md`). The token
 * arrives one of two ways and is persisted in `localStorage` so it survives
 * reloads and route changes:
 *
 *  1. embedded in the URL as `?key=…` (the staff cheat-sheet / host QR), or
 *  2. typed into the `/debug` key prompt.
 *
 * `getOperatorKey()` resolves the effective key (URL wins, and is persisted);
 * `withKey()` appends it to a request URL. The display app calls these when
 * building the MJPEG/QR requests, the `/ws/frames` URL, and the `hello` it
 * sends; the pocket app calls them for its staff CAMERA role (a staff QR opens
 * `/pocket?connect=1&role=camera&key=…` pre-authorized). Read-only viewer
 * surfaces never touch any of this.
 *
 * SECURITY: the key is a credential, so once read from the URL it is stored and
 * immediately scrubbed from the address bar (`history.replaceState`) — it is
 * never rendered back into visible UI, and a shared/reloaded link does not leak
 * it via the location bar or the browser history entry. Lives in `shared/ws`
 * (moved from the display app in U2) so both apps share one implementation; the
 * display app keeps a re-export shim.
 */

/** localStorage key holding the operator token. */
export const OPERATOR_KEY_STORAGE = 'entangible.operator.key';

function readUrlKey(): string | null {
  try {
    const params = new URLSearchParams(globalThis.location?.search ?? '');
    const k = params.get('key');
    return k && k.trim() ? k.trim() : null;
  } catch {
    return null;
  }
}

/**
 * Remove the `key` param from the visible URL without a reload or a new history
 * entry. Called right after a URL key is stored so the credential never lingers
 * in the address bar (and is not carried into a shared/copied link). Other
 * params (e.g. `connect=1&role=camera`) are preserved. Best-effort: unavailable
 * `history`/`URL` (non-browser, sandboxed) is silently tolerated.
 */
function stripKeyFromUrl(): void {
  try {
    const loc = globalThis.location;
    const hist = globalThis.history;
    if (!loc || !hist || typeof hist.replaceState !== 'function') return;
    const url = new URL(loc.href);
    if (!url.searchParams.has('key')) return;
    url.searchParams.delete('key');
    hist.replaceState(hist.state, '', url.pathname + url.search + url.hash);
  } catch {
    /* history/URL unavailable — the stored key still works for this load */
  }
}

function readStored(): string | null {
  try {
    const k = globalThis.localStorage?.getItem(OPERATOR_KEY_STORAGE);
    return k && k.trim() ? k.trim() : null;
  } catch {
    return null;
  }
}

/** Persist an operator key (no-op if storage is unavailable). */
export function storeOperatorKey(key: string): void {
  try {
    globalThis.localStorage?.setItem(OPERATOR_KEY_STORAGE, key.trim());
  } catch {
    /* storage unavailable — the in-URL key still works for this load */
  }
}

/** Forget the stored operator key (used by the "clear key" affordance). */
export function clearOperatorKey(): void {
  try {
    globalThis.localStorage?.removeItem(OPERATOR_KEY_STORAGE);
  } catch {
    /* ignore */
  }
}

/**
 * Resolve the effective operator key, or `null` if none is available.
 *
 * A `?key=` in the URL wins and is persisted (the staff QR carries it), so a
 * fresh `/pocket?…&role=camera&key=…` or `/debug?key=…` visit is authenticated
 * with no prompt; otherwise the previously stored key is used.
 */
export function getOperatorKey(): string | null {
  const fromUrl = readUrlKey();
  if (fromUrl) {
    storeOperatorKey(fromUrl);
    // Scrub the credential from the address bar now that it is persisted.
    stripKeyFromUrl();
    return fromUrl;
  }
  return readStored();
}

/** Append `key=<token>` to `url` when an operator key is available. */
export function withKey(url: string): string {
  const key = getOperatorKey();
  if (!key) return url;
  const sep = url.includes('?') ? '&' : '?';
  return `${url}${sep}key=${encodeURIComponent(key)}`;
}
