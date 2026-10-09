/**
 * Quantina pack resolution (docs/quantina.md, QN1) — split out of QuantinaPanel
 * so App can call it on every render (the histogram's qubit count, the mode
 * pill) while the panel itself stays a lazily loaded chunk.
 *
 * Resolves the settings (or booth) menu id via `useResolvedPack`: a built-in
 * resolves synchronously, a custom host-served id is fetched from
 * `/api/menu/pack/{id}` (QN3; `coffee` meanwhile / on failure), and, when
 * `?menupack=<url>` is present, a remote wire-JSON pack is fetched + validated
 * on top — asynchronously, never blocking the UI: the fallback pack shows until
 * it lands, and a `?menupack=` fetch/validation failure surfaces a small inline
 * note and keeps the fallback.
 */
import { useEffect, useMemo, useState } from 'react';
import { validatePack, type MenuPack } from '@shared/menu/pack';
import { useSettings } from './settings';
import { useResolvedPack } from './packSource';

/** Resolved pack + async remote-pack status, shared by App and the panel. */
export interface QuantinaPackState {
  pack: MenuPack;
  /** True while a `?menupack=<url>` fetch is in flight (App shows "Quantina"). */
  loading: boolean;
  /** Inline note when a remote pack fails to load (the fallback pack is used). */
  error: string | null;
}

/**
 * Resolve the active pack. The settings menu id maps to a built-in pack; a
 * session-only `?menupack=<url>` (read once, never persisted) overrides it once
 * it validates. Failures fall back to the settings pack and expose an error.
 */
export function useQuantinaPack(overrideMenuId?: string | null): QuantinaPackState {
  const settings = useSettings();
  // The base pack id: a caller-supplied override (the booth's active `menu`
  // while connected) wins over the local setting; null/undefined → the setting.
  // Keeps this QN1 hook the single owner of pack resolution (+ `?menupack=`).
  const menuId = overrideMenuId ?? settings.menu;
  // The base pack: built-in (sync) or a host-served custom pack (async, coffee
  // meanwhile). Same-origin — a host-served pocket app answers its own origin.
  const { pack: settingsPack, loading: packLoading } = useResolvedPack(menuId);
  const menupackUrl = useMemo(
    () =>
      typeof window !== 'undefined'
        ? new URLSearchParams(window.location.search).get('menupack')
        : null,
    [],
  );
  const [remotePack, setRemotePack] = useState<MenuPack | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState<boolean>(menupackUrl !== null);

  useEffect(() => {
    if (!menupackUrl) {
      setLoading(false);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    setRemotePack(null);
    fetch(menupackUrl)
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`HTTP ${r.status}`))))
      .then((json) => {
        if (cancelled) return;
        const res = validatePack(json);
        if (res.ok) setRemotePack(res.pack);
        else setError(res.errors[0] ?? 'invalid menu pack');
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [menupackUrl]);

  return { pack: remotePack ?? settingsPack, loading: loading || packLoading, error };
}
