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
 * Pack resolution lives in `useQuantinaPack` (./quantinaPack): App calls it on
 * every render, so it stays in the entry chunk while this panel loads lazily.
 */
import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { Circuit } from '@qamposer/react';
import { MenuGrid } from '@shared/menu/MenuGrid';
import { OrderCard } from '@shared/menu/OrderCard';
import { ServeReveal } from '@shared/menu/ServeReveal';
import type { MenuPack } from '@shared/menu/pack';
import { cryptoRng } from '@shared/menu/sample';
import { localizePack } from '@shared/menu/builtinPacks';
import { useT } from '@shared/i18n';
import {
  menuOutcomes,
  orderLines,
  serveFrom,
  type ServeResult,
  type ShotSource,
} from './quantina';

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
  const t = useT().quantina;
  return (
    <div className="pk-quantina-shots">
      <span className="pk-quantina-shots-label">{t.scoops}</span>
      <div className="pk-quantina-stepper" role="group" aria-label={t.shotsAria}>
        <button
          type="button"
          className="pk-quantina-step"
          aria-label={t.fewer}
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
          aria-label={t.more}
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
  pack: authoredPack,
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
  const t = useT();
  // A built-in menu reads in the visitor's language; custom packs as authored.
  const pack = useMemo(() => localizePack(authoredPack, t), [authoredPack, t]);
  const shotsBounds = pack.serve.shots;
  const [shots, setShots] = useState(shotsBounds?.default ?? 1);
  const [result, setResult] = useState<ServeResult | null>(null);
  const [seq, setSeq] = useState(0);

  // An external (booth-synced) result wins over any local serve; its own seq
  // drives the reveal so a new broadcast re-animates even for the same item.
  const shownResult = externalResult ?? result;
  const shownSeq = externalResult ? externalSeq : seq;

  // A pack switch invalidates the shot count and any prior order (a language
  // switch re-words the same pack and keeps both).
  useEffect(() => {
    setShots(authoredPack.serve.shots?.default ?? 1);
    setResult(null);
    setSeq(0);
  }, [authoredPack]);

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
          {t.quantina.loadError(error, pack.title)}
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
            {t.quantina.serve}
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
