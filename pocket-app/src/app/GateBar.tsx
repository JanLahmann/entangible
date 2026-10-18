/**
 * Golf's gate bar — the hole's clubs as real buttons (part of `TapPlay`).
 *
 * A tap picks a club as the active tool (`aria-pressed`); it stays picked for
 * repeated placement and a second tap puts it down. While a placed gate is
 * selected in the grid instead, the clubs read "Replace with …" and a tap
 * swaps that gate (a one-qubit gate only for another one-qubit club, a
 * two-qubit gate only for another two-qubit club).
 */
import type { Gate, GateType } from '@qamposer/react';
import type { Messages } from '@shared/i18n';
import { canReplace, type BarClub } from './tapPlacement';

export interface GateBarProps {
  readonly clubs: readonly BarClub[];
  /** The hole's qubit count (a two-qubit club needs two). */
  readonly qubits: number;
  readonly tool: GateType | null;
  /** The placed gate selected in the grid, if any (clubs then replace it). */
  readonly selected: Gate | null;
  readonly disabled: boolean;
  readonly onClub: (club: BarClub) => void;
  readonly t: Messages;
}

export function GateBar({ clubs, qubits, tool, selected, disabled, onClub, t }: GateBarProps) {
  const m = t.tapPlay;
  return (
    <div className="pk-gatebar-clubs" role="group" aria-label={m.clubsAria}>
      {clubs.map((club) => {
        const tooFew = club.twoQubit && qubits < 2;
        const noSwap = selected !== null && !canReplace(selected, club.type);
        const name = tooFew
          ? m.needsTwo(club.label)
          : selected
            ? noSwap
              ? m.cannotReplace(club.label)
              : m.replaceWith(club.label)
            : m.tool(club.label);
        const pressed = selected === null && tool === club.type;
        return (
          <button
            key={club.type}
            type="button"
            className={`pk-gatebar-club${club.twoQubit ? ' is-two' : ''}${pressed ? ' is-on' : ''}`}
            data-gate={club.type}
            aria-label={name}
            aria-pressed={selected === null ? pressed : undefined}
            disabled={disabled || tooFew || noSwap}
            onClick={() => onClub(club)}
          >
            {club.label}
          </button>
        );
      })}
    </div>
  );
}

export default GateBar;
