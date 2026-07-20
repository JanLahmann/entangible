/**
 * QuantinaPanel — the pocket Quantina surface (docs/quantina.md, QN1).
 *
 * Composes the shared, style-free menu components (`MenuGrid` / `OrderCard` /
 * `ServeReveal`) with pocket's serve state and `pk-` styling. The live menu
 * numbers and the serve draw both come from `menuOutcomes` — the SAME vector the
 * paired RESULTS histogram shows (ideal, or the noise preset's when active), so
 * a peaked column and its highlighted card always agree and a noisy serve can
 * hand you the wrong drink on purpose.
 *
 * Pack resolution lives in `useQuantinaPack` (exported so App can read the pack
 * for the histogram's qubit count and the mode pill). It resolves the settings
 * menu id to a built-in pack (unknown id → `coffee` + a warn) and, when
 * `?menupack=<url>` is present, fetches + validates a remote wire-JSON pack —
 * asynchronously, never blocking the UI: the settings pack shows until it lands,
 * and a fetch/validation failure surfaces a small inline note and keeps the
 * fallback.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Circuit } from '@qamposer/react';
import { MenuGrid } from '@shared/menu/MenuGrid';
import { OrderCard } from '@shared/menu/OrderCard';
import { ServeReveal } from '@shared/menu/ServeReveal';
import { validatePack, type MenuPack } from '@shared/menu/pack';
import { cryptoRng } from '@shared/menu/sample';
import { useSettings } from './settings';
import {
  menuOutcomes,
  orderLines,
  resolvePack,
  serveFrom,
  type ServeResult,
  type ShotSource,
} from './quantina';

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
  const settingsPack = useMemo(() => resolvePack(menuId), [menuId]);
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

  return { pack: remotePack ?? settingsPack, loading, error };
}

/** Shot-count stepper for `shots` packs — bounded by the pack's serve bounds. */
function ShotsStepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (n: number) => void;
}) {
  return (
    <div className="pk-quantina-shots">
      <span className="pk-quantina-shots-label">Scoops</span>
      <div className="pk-quantina-stepper" role="group" aria-label="Number of shots">
        <button
          type="button"
          className="pk-quantina-step"
          aria-label="Fewer"
          disabled={value <= min}
          onClick={() => onChange(Math.max(min, value - 1))}
        >
          −
        </button>
        <span className="pk-quantina-shots-val" aria-live="polite">
          {value}
        </span>
        <button
          type="button"
          className="pk-quantina-step"
          aria-label="More"
          disabled={value >= max}
          onClick={() => onChange(Math.min(max, value + 1))}
        >
          +
        </button>
      </div>
    </div>
  );
}

export function QuantinaPanel({
  pack,
  error = null,
  circuit,
  noisyProbs,
  externalResult = null,
  externalSeq = 0,
  canServe = true,
}: {
  pack: MenuPack;
  /** Remote-pack load error, if any (from `useQuantinaPack`). */
  error?: string | null;
  circuit: Circuit;
  /** The App-memoized noisy vector — present ⟺ a noise preset is active. */
  noisyProbs?: readonly number[];
  /**
   * An externally-supplied serve result to reveal (QN2 viewer sync): the booth's
   * `served` broadcast, resolved through the same `orderLines` path. When set it
   * takes precedence over any local serve. `null` → local serves only.
   */
  externalResult?: ServeResult | null;
  /** Reveal key for `externalResult` — bump it (served.seq) to re-animate. */
  externalSeq?: number;
  /**
   * Whether this surface may serve locally (default true). A connected viewer
   * passes `false` to hide the Serve button + shot stepper (read-only policy).
   */
  canServe?: boolean;
}) {
  const shotsBounds = pack.serve.shots;
  const [shots, setShots] = useState(shotsBounds?.default ?? 1);
  const [result, setResult] = useState<ServeResult | null>(null);
  const [seq, setSeq] = useState(0);

  // An external (booth-synced) result wins over any local serve; its own seq
  // drives the reveal so a new broadcast re-animates even for the same item.
  const shownResult = externalResult ?? result;
  const shownSeq = externalResult ? externalSeq : seq;

  // A pack switch invalidates the shot count and any prior order.
  useEffect(() => {
    setShots(pack.serve.shots?.default ?? 1);
    setResult(null);
    setSeq(0);
  }, [pack]);

  // The live menu vector — ideal or (preset active) noisy — marginalized to the
  // pack's qubits. One simulation feeds both this panel and the histogram.
  const outcomes = useMemo(
    () => menuOutcomes(circuit, pack, noisyProbs),
    [circuit, pack, noisyProbs],
  );

  const serve = () => {
    const shotSource: ShotSource = noisyProbs ? 'noisy' : 'ideal';
    setResult(serveFrom(outcomes, pack, shots, cryptoRng(), shotSource));
    setSeq((s) => s + 1);
  };

  const lines = useMemo(
    () => (shownResult ? orderLines(pack, shownResult) : []),
    [pack, shownResult],
  );

  // Packs restyle their OWN menu, not the whole app: apply the accent only here.
  const accentStyle: CSSProperties | undefined = pack.theme?.accent
    ? ({ ['--accent']: pack.theme.accent } as CSSProperties)
    : undefined;

  return (
    <div className="pk-quantina" style={accentStyle}>
      {error && (
        <p className="pk-quantina-error" role="status">
          Couldn’t load that menu ({error}) — showing {pack.title}.
        </p>
      )}

      {/* Serve controls are hidden for a read-only viewer (canServe=false): the
          booth is the single serving authority; the viewer only reveals. */}
      {canServe && (
        <div className="pk-quantina-serve">
          {shotsBounds && shotsBounds.max > shotsBounds.min && (
            <ShotsStepper
              value={shots}
              min={shotsBounds.min}
              max={shotsBounds.max}
              onChange={setShots}
            />
          )}
          <button type="button" className="pk-btn pk-quantina-serve-btn" onClick={serve}>
            Serve
          </button>
        </div>
      )}

      {shownResult && (
        <ServeReveal seq={shownSeq} classPrefix="pk">
          <OrderCard pack={pack} result={shownResult} lines={lines} classPrefix="pk" />
        </ServeReveal>
      )}

      <MenuGrid pack={pack} outcomes={outcomes} classPrefix="pk" />

      {(pack.tagline || (pack.links && pack.links.length > 0)) && (
        <div className="pk-quantina-foot">
          {pack.tagline && <span className="pk-quantina-tagline">{pack.tagline}</span>}
          {pack.links && pack.links.length > 0 && (
            <div className="pk-quantina-links">
              {pack.links.map((l) => (
                <a key={l.url} href={l.url} target="_blank" rel="noreferrer">
                  {l.name}
                </a>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default QuantinaPanel;
