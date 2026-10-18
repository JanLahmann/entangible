/**
 * The evolution step the golf sphere shows, handed from `GolfBoard` (which
 * owns the `EvolvingState` scrubber) to tap-to-play under it (`TapPlay`), so
 * the tap grid can mark the column the replay is at (#13). Null when there is
 * nothing to mark: no hole holed in, or no `GolfBoard` around (tests, other
 * hosts).
 */
import { createContext } from 'react';
import type { EvolutionStep } from '@shared/display/EvolvingState';

export const GolfReplayContext = createContext<EvolutionStep | null>(null);
