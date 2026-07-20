/**
 * AttractMode — the kiosk idle screensaver loop (docs/booth-ux.md → Attract
 * mode). Ported from the former display-app booth surface (Entangible One,
 * phase U3).
 *
 * Pure CSS animations only (no canvas, no libraries): a slow ~12 s loop that
 * shows the wordmark, a ghost H tile sliding onto a drawn mini-board, a ghost
 * ●⊕ pair with a spark of mini-confetti, and a 48 px call to action — all at
 * ≤ 30 % brightness. The whole thing is mounted only while attract is active;
 * the parent unmounts it on any activity, which is the "< 100 ms instant cut"
 * exit (React removes it synchronously on the next paint).
 */
import { VisitorQr } from './VisitorQr';
import { ATTRACT_TAGLINES } from './attract';

const MINI_CONFETTI = ['#fa4d56', '#002d9c', '#9f1853', '#33b1ff'];

/** Event branding shown as the attract-mode co-brand ("Entangible at ⟨event⟩"). */
export interface AttractBranding {
  name?: string | null;
  logoUrl?: string | null;
}

export function AttractMode({ branding }: { branding?: AttractBranding | null }) {
  // Co-brand only when an event name is configured (docs/booth-ux.md → branding).
  const eventName = branding?.name?.trim() || null;
  const label = eventName
    ? `Entangible at ${eventName} — place a tile on the table to begin`
    : 'Entangible — place a tile on the table to begin';
  return (
    <div className="ent-attract" role="img" aria-label={label}>
      <div className="ent-attract__stage">
        <div className="ent-attract__wordmark">Entangible</div>
        {eventName && (
          <div className="ent-attract__cobrand">
            <span className="ent-attract__cobrand-at">at</span>
            {branding?.logoUrl ? (
              <img src={branding.logoUrl} alt={eventName} />
            ) : (
              <span className="ent-attract__cobrand-name">{eventName}</span>
            )}
          </div>
        )}

        <div className="ent-attract__board">
          {/* five drawn qubit wires */}
          {[0, 1, 2, 3, 4].map((q) => (
            <div className="ent-attract__wire" key={q} />
          ))}

          {/* ghost H tile that slides in and "lands" as a gate */}
          <div className="ent-attract__tile ent-attract__tile--h">H</div>

          {/* ghost control/target pair on the lower wires */}
          <div className="ent-attract__cnot">
            <span className="ent-attract__control">●</span>
            <span className="ent-attract__link" />
            <span className="ent-attract__target">⊕</span>
          </div>

          {/* mini confetti spark */}
          <div className="ent-attract__confetti">
            {MINI_CONFETTI.map((c, i) => (
              <span key={i} style={{ background: c }} className={`ent-attract__spark ent-attract__spark--${i}`} />
            ))}
          </div>
        </div>

        {/* Rotating call to action: the build prompt cross-fades with the
            Quantina "order your coffee" line (QN2). Both stay in the DOM; CSS
            animates opacity and reduced-motion shows them stacked. */}
        <div className="ent-attract__cta">
          {ATTRACT_TAGLINES.map((line, i) => (
            <span key={i} className={`ent-attract__cta-line ent-attract__cta-line--${i}`}>
              {line}
            </span>
          ))}
        </div>

        {/* visitor QR — follow along on your phone + take the circuit home */}
        <VisitorQr variant="attract" />

        {/* site + family credit — the booth's public face at events */}
        <div className="ent-attract__site">
          entangible.org · a Fun with Quantum project
        </div>
      </div>
    </div>
  );
}

export default AttractMode;
