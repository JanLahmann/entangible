/**
 * OrderCard — "You ordered: …", the reveal after a serve (classPrefix-shared).
 *
 * Renders the resolved order lines (emoji · name · count — "2×" only when a shot
 * count repeated), the winning bitstring(s) as chips, and a tag naming where the
 * outcome was sampled from. An empty subset serve ("just the glass") gets a
 * friendly empty line rather than a blank card. Style-free: each app provides
 * its own `<prefix>-order…` CSS.
 *
 * The prop types are declared STRUCTURALLY here (not imported from a pocket
 * module) so `shared/` stays free of any app dependency; a pocket `ServeResult`
 * / `OrderLine` assigns to them by shape. 'real' is included in the shot-source
 * union for QN2's staff-entered real-hardware serves.
 */
import type { MenuItem, MenuPack, ShotSource } from './pack';

export type { ShotSource };

/** The minimal serve shape the card renders (pocket's `ServeResult` fits it). */
export interface OrderResult {
  outcomes: string[];
  shotSource: ShotSource;
}

/** One order line: a menu item and its count (pocket's `OrderLine` fits it). */
export interface OrderLine {
  item: MenuItem;
  count: number;
}

/** Human tag for where the serve was sampled — the teaching moment on the card. */
const SHOT_SOURCE_TAG: Record<ShotSource, string> = {
  ideal: 'sampled from the ideal state',
  noisy: 'sampled with hardware noise',
  real: 'measured on real hardware',
};

export function OrderCard({
  result,
  lines,
  classPrefix,
}: {
  /** The pack is accepted for symmetry/future use; the card reads only the serve. */
  pack: MenuPack;
  result: OrderResult;
  lines: readonly OrderLine[];
  classPrefix: string;
}) {
  const p = classPrefix;
  const empty = lines.length === 0;
  return (
    <div className={`${p}-order`}>
      <div className={`${p}-order-head`}>You ordered</div>
      {empty ? (
        // subset serve with no set bits — an honest, friendly "nothing in the glass".
        <div className={`${p}-order-empty`}>
          <span aria-hidden="true">🥛</span> just the glass
        </div>
      ) : (
        <ul className={`${p}-order-lines`}>
          {lines.map(({ item, count }) => (
            <li key={item.code ?? `q${item.qubit}`} className={`${p}-order-line`}>
              <span className={`${p}-order-emoji`} aria-hidden="true">
                {item.emoji}
              </span>
              <span className={`${p}-order-name`}>{item.name}</span>
              {count > 1 && <span className={`${p}-order-count`}>{count}×</span>}
            </li>
          ))}
        </ul>
      )}
      <div className={`${p}-order-codes`}>
        {result.outcomes.map((bits, i) => (
          <span key={`${bits}-${i}`} className={`${p}-order-chip`}>
            {bits}
          </span>
        ))}
      </div>
      <div className={`${p}-order-tag`}>{SHOT_SOURCE_TAG[result.shotSource]}</div>
    </div>
  );
}

export default OrderCard;
