/**
 * Quantum Golf scorecard — pocket (`pk-`) binding of the shared Scorecard (SC2).
 * The body lives in `@shared/display/Scorecard`; pocket reads the best-of-device
 * latched golf state, tints its target ket monospace (`monoKet`), and injects
 * the challenge-a-friend QR (#84), which needs the pocket-only `qrcode` dep.
 */
import type { Circuit } from '@qamposer/react';
import type { GolfState } from '@quantum/golf';
import { Scorecard as SharedScorecard } from '@shared/display/Scorecard';
import { CourseChallenge } from './CourseChallenge';

export function Scorecard({
  state,
  circuit,
  onNextLevel,
  onReveal,
  onWipe,
  onJump,
}: {
  state: GolfState;
  circuit: Circuit;
  /** Build-on-screen only: renders the shared card's Next-level button. */
  onNextLevel?: () => void;
  /** Takes the mid-hole reveal's double-par price (#99) through the engine. */
  onReveal?: (holeNumber: number) => void;
  /** Build-on-screen only: wipes the board for one flat stroke (#100). */
  onWipe?: () => void;
  /** Tap any chip to play that hole (#101). */
  onJump?: (holeNumber: number) => void;
}) {
  return (
    <SharedScorecard
      state={state}
      circuit={circuit}
      classPrefix="pk"
      monoKet
      challenge={({ code, link, scope }) => (
        <CourseChallenge code={code} link={link} scope={scope} />
      )}
      onNextLevel={onNextLevel}
      onReveal={onReveal}
      onWipe={onWipe}
      onJump={onJump}
    />
  );
}

export default Scorecard;
