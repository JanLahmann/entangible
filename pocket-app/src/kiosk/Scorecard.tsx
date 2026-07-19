/**
 * Quantum Golf scorecard — kiosk (`bo-`) binding of the shared Scorecard (SC2).
 * Ported from the former display-app booth surface (Entangible One, phase U3).
 * The body lives in `@shared/display/Scorecard`; the kiosk reads the in-memory
 * latched golf state (no localStorage) and leaves its target ket untinted.
 */
import type { Circuit } from '@qamposer/react';
import type { GolfState } from '@quantum/golf';
import { Scorecard as SharedScorecard } from '@shared/display/Scorecard';

export function Scorecard({ state, circuit }: { state: GolfState; circuit: Circuit }) {
  return <SharedScorecard state={state} circuit={circuit} classPrefix="bo" />;
}

export default Scorecard;
