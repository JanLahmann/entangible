/**
 * Host menu-pack resolution (QN3 custom packs).
 *
 * A menu id that is NOT one of the bundled built-ins may name a CUSTOM pack the
 * host serves from its `menu/<id>/pack.toml` directory (docs/menu-packs.md). This
 * module fetches such a pack's wire JSON from `/api/menu/pack/{id}`, re-validates
 * it with the shared `validatePack` (the host only checks structure), and caches
 * the result — plus a tiny React hook, `useResolvedPack`, that both the pocket
 * Quantina surface and the kiosk use to resolve a menu id to a concrete pack:
 * built-in synchronously, custom asynchronously, `coffee` as the always-safe
 * fallback while a fetch is in flight or after it fails.
 */
import { useEffect, useMemo, useState } from 'react';
import { validatePack, type MenuPack } from '@shared/menu/pack';
import { builtinPack } from '@shared/menu/builtinPacks';

/** In-memory cache by pack id: a resolved pack, or `null` for a known miss. */
const cache = new Map<string, MenuPack | null>();

/**
 * Fetch + validate a host-served custom pack. Returns the normalized `MenuPack`
 * on success, or `null` on any failure (network, non-2xx, invalid schema) —
 * always with a `console.warn`, never throwing. Results (including misses) are
 * cached by id so a pack resolves once per session.
 */
export async function fetchHostPack(baseUrl: string, id: string): Promise<MenuPack | null> {
  if (cache.has(id)) return cache.get(id) ?? null;
  try {
    const res = await fetch(`${baseUrl}/api/menu/pack/${id}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    const validated = validatePack(json);
    if (!validated.ok) throw new Error(validated.errors[0] ?? 'invalid menu pack');
    cache.set(id, validated.pack);
    return validated.pack;
  } catch (err) {
    // eslint-disable-next-line no-console
    console.warn(`[quantina] could not load host menu pack "${id}":`, err);
    cache.set(id, null);
    return null;
  }
}

/** Clear the pack cache — test seam (not used at runtime). */
export function _clearPackCache(): void {
  cache.clear();
}

/** A resolved pack plus whether a host fetch is currently in flight. */
export interface ResolvedPack {
  pack: MenuPack;
  loading: boolean;
}

/**
 * Resolve a menu id to a pack. A built-in id (or a null/empty id) resolves
 * synchronously; any other id is fetched from the host (same origin by default)
 * and validated, with `coffee` shown meanwhile and kept if the fetch fails.
 * `baseUrl` defaults to same-origin — the kiosk is always host-served, and a
 * host-served pocket app answers its own origin (the `servedByHost` signal).
 */
export function useResolvedPack(menuId: string | null | undefined, baseUrl = ''): ResolvedPack {
  const builtin = useMemo(() => (menuId ? builtinPack(menuId) : undefined), [menuId]);
  const needsFetch = !!menuId && !builtin;
  const [hostPack, setHostPack] = useState<MenuPack | null>(null);
  const [loading, setLoading] = useState(needsFetch);

  useEffect(() => {
    setHostPack(null);
    if (!needsFetch || !menuId) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    fetchHostPack(baseUrl, menuId)
      .then((p) => {
        if (!cancelled) setHostPack(p);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [menuId, needsFetch, baseUrl]);

  const pack = builtin ?? hostPack ?? builtinPack('coffee')!;
  return { pack, loading };
}
