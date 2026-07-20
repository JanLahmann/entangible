/**
 * MenuGrid — the live Quantina menu (classPrefix-shared, style-free).
 *
 * One card per pack item, in the pack's normalized order (sorted by code, or by
 * qubit in subset mode). Each card shows the emoji, name, optional subtitle, the
 * item's code chip (`010`) — or a `q1` chip in subset mode — and its LIVE
 * probability: the outcome's probability for single/shots, or the qubit's
 * marginal P(bit=1) for subset. The probability drives a pure-CSS fill bar via a
 * `--p` custom property on the card (0..1), so the bar needs no inline width.
 *
 * The argmax item gets `is-peak`; auto-padded house items get a `--house`
 * modifier. The numbers come from the exact `Outcome[]` the histogram renders
 * (`@shared/display/outcomes`), so a peaked column and its highlighted card
 * always agree. Each app supplies its own `<prefix>-menu…` CSS.
 */
import type { CSSProperties } from 'react';
import type { Outcome } from '@shared/display/outcomes';
import type { MenuItem, MenuPack } from './pack';
import { marginals } from './sample';

export function MenuGrid({
  pack,
  outcomes,
  classPrefix,
}: {
  pack: MenuPack;
  outcomes: readonly Outcome[];
  classPrefix: string;
}) {
  const p = classPrefix;
  const subset = pack.serve.mode === 'subset';
  // subset shows each qubit's marginal; single/shots show the outcome probability.
  const marg = subset ? marginals(outcomes) : null;
  const byBits = new Map(outcomes.map((o) => [o.bits, o.prob]));
  const probOf = (item: MenuItem): number =>
    subset ? (marg![item.qubit!] ?? 0) : (byBits.get(item.code!) ?? 0);

  const probs = pack.items.map(probOf);
  // Argmax card (defaults to 0 on an all-zero vector) — the current "peak" order.
  const peak = probs.reduce((best, v, i) => (v > probs[best] ? i : best), 0);

  return (
    <div>
      <div className={`${p}-label`}>{pack.title}</div>
      <div className={`${p}-menu`}>
        {pack.items.map((item, i) => {
          const prob = probs[i];
          const chip = subset ? `q${item.qubit}` : item.code;
          const cls = [
            `${p}-menu-card`,
            item.house ? `${p}-menu-card--house` : '',
            i === peak ? 'is-peak' : '',
          ]
            .filter(Boolean)
            .join(' ');
          return (
            <div
              key={subset ? `q${item.qubit}` : item.code}
              className={cls}
              style={{ ['--p']: prob } as CSSProperties}
            >
              <span className={`${p}-menu-emoji`} aria-hidden="true">
                {item.emoji}
              </span>
              <span className={`${p}-menu-name`}>{item.name}</span>
              {item.subtitle && <span className={`${p}-menu-sub`}>{item.subtitle}</span>}
              <span className={`${p}-menu-chip`}>{chip}</span>
              <span className={`${p}-menu-p`}>{`${Math.round(prob * 100)}%`}</span>
              <span className={`${p}-menu-bar`} aria-hidden="true" />
            </div>
          );
        })}
      </div>
    </div>
  );
}

export default MenuGrid;
