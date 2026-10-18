// @vitest-environment jsdom
/**
 * Golf tap-to-play (TapPlay = GateBar + TapCircuit), driven the way the shells
 * drive it: a `ManualEditSource` feeding `useGolfGame.step`, with tap-to-play's
 * `onChange` being the editor's own `setFromEditor`.
 *
 * Stroke parity: every tap-only play is compared with the SAME hole fed the
 * circuits the editor would emit, through a second `useGolfGame` — add 1,
 * delete 1, replace 2, undo what its board change is, a GHZ chain its gates.
 * Plus: tool selection, CX control → target and cancel, a mid-circuit insert,
 * selection / delete / replace / undo / clear, the spoken status, accessible
 * names on every control (EN and DE).
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import type { Circuit, Gate } from '@qamposer/react';
import { LangProvider } from '@shared/i18n';
import { ManualEditSource } from '../sources/ManualEditSource';
import { TapPlay } from './TapPlay';
import { useGolfGame, type GolfGame, type GolfGameOptions } from './useGolfGame';

const EMPTY: Circuit = { qubits: 5, gates: [] } as Circuit;

afterEach(cleanup);

/** The live game + board, for assertions. */
const live: { game: GolfGame | null; circuit: Circuit } = { game: null, circuit: EMPTY };

function Harness() {
  const sourceRef = useRef(new ManualEditSource());
  const [circuit, setCircuit] = useState<Circuit>(EMPTY);
  const game = useGolfGame({
    storage: null,
    courseCode: null,
    courseScope: null,
    setCourseCode: () => {},
    setCourseScope: () => {},
    clearBoard: () => sourceRef.current.clear(),
    circuit,
    onCelebrate: () => {},
  });
  live.game = game;
  live.circuit = circuit;
  const step = game.step;
  useEffect(() => {
    const source = sourceRef.current;
    const unsub = source.subscribe((u) => {
      setCircuit(u.circuit);
      step(u.circuit);
    });
    source.start();
    return () => {
      unsub();
      source.stop();
    };
  }, [step]);
  return <TapPlay game={game} circuit={circuit} onChange={(c: Circuit) => sourceRef.current.setFromEditor(c)} />;
}

async function mount(hole = 1, lang: 'en' | 'de' = 'en') {
  const utils = render(
    <LangProvider lang={lang}>
      <Harness />
    </LangProvider>,
  );
  await act(async () => {});
  if (hole !== 1) act(() => live.game!.jumpToHole(hole));
  return utils;
}

const tap = (name: string | RegExp) => fireEvent.click(screen.getByRole('button', { name }));
const strokes = () => live.game!.state.strokes;
const spoken = () => screen.getByRole('status').textContent;
const board = () =>
  live.circuit.gates
    .map((g) => [g.type, g.qubit ?? null, g.control ?? null, g.target ?? null, g.position])
    .sort((a, b) => (a[4] as number) - (b[4] as number) || String(a).localeCompare(String(b)));

/** The same hole played through `step` with the boards the editor emits. */
function editorPlay(hole: number, boards: Gate[][]) {
  const opts: GolfGameOptions = {
    storage: null,
    courseCode: null,
    courseScope: null,
    setCourseCode: () => {},
    setCourseScope: () => {},
    clearBoard: () => {},
    circuit: EMPTY,
    onCelebrate: () => {},
  };
  const hook = renderHook((p: GolfGameOptions) => useGolfGame(p), { initialProps: opts });
  act(() => hook.result.current.step(EMPTY));
  if (hole !== 1) act(() => hook.result.current.jumpToHole(hole));
  for (const gates of boards) {
    const c = { qubits: 5, gates } as Circuit;
    act(() => hook.result.current.step(c));
    hook.rerender({ ...opts, circuit: c });
  }
  return hook.result.current.state;
}

const H0: Gate = { id: 'e-h', type: 'H', qubit: 0, position: 0 };
const CX01: Gate = { id: 'e-cx', type: 'CNOT', control: 0, target: 1, position: 1 };
const CX12: Gate = { id: 'e-cx2', type: 'CNOT', control: 1, target: 2, position: 2 };

describe('TapPlay — clubs and tool', () => {
  it('a 1-qubit hole: its clubs, CX shown but not playable, one row of empty cells', async () => {
    await mount(1);
    expect(screen.getByRole('button', { name: 'X gate' }).getAttribute('aria-pressed')).toBe('false');
    expect((screen.getByRole('button', { name: 'CX needs two qubits — not on this hole' }) as HTMLButtonElement).disabled).toBe(true);
    const grid = screen.getByRole('group', { name: 'Circuit, 1 qubits, 3 steps' });
    expect(within(grid).getAllByRole('button').map((b) => b.getAttribute('aria-label'))).toEqual([
      'Qubit 0, step 1, empty',
      'Qubit 0, step 2, empty',
      'Qubit 0, step 3, empty',
    ]);
  });

  it('a tap picks the tool (aria-pressed), it stays picked, a second tap puts it down', async () => {
    await mount(2);
    tap('H gate');
    expect(screen.getByRole('button', { name: 'H gate' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Qubit 1, step 1, empty: place H' })).toBeTruthy();
    tap('Qubit 0, step 1, empty: place H');
    tap('Qubit 1, step 1, empty: place H');
    expect(strokes()).toBe(2);
    expect(screen.getByRole('button', { name: 'H gate' }).getAttribute('aria-pressed')).toBe('true');
    tap('H gate');
    expect(screen.getByRole('button', { name: 'H gate' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.getByRole('button', { name: 'Qubit 0, step 2, empty' })).toBeTruthy();
  });
});

describe('TapPlay — playing holes by taps scores like the editor', () => {
  it('E1: H on qubit 0 holes in for 1 stroke, as the editor’s H does', async () => {
    await mount(1);
    tap('H gate');
    tap('Qubit 0, step 1, empty: place H');
    expect(live.game!.state.holedIn).toBe(true);
    const editor = editorPlay(1, [[H0]]);
    expect(editor.holedIn).toBe(true);
    expect(strokes()).toBe(editor.strokes);
    expect(strokes()).toBe(1);
    expect(spoken()).toBe('Placed H on qubit 0, step 1. The ball is in — EAGLE!');
  });

  it('E2 (Bell): H, then CX control → lit target; 2 strokes, as in the editor', async () => {
    await mount(2);
    tap('H gate');
    tap('Qubit 0, step 1, empty: place H');
    tap('CX gate');
    tap('Qubit 0, step 2, empty: place CX control');
    expect(spoken()).toBe('CX control on qubit 0, step 2. Now tap the target.');
    const target = screen.getByRole('button', { name: 'Qubit 1, step 2: place CX target' });
    expect(target.className).toContain('is-target-option');
    fireEvent.click(target);
    expect(board()).toEqual([
      ['H', 0, null, null, 0],
      ['CNOT', null, 0, 1, 1],
    ]);
    expect(live.game!.state.holedIn).toBe(true);
    const editor = editorPlay(2, [[H0], [H0, CX01]]);
    expect(strokes()).toBe(editor.strokes);
    expect(strokes()).toBe(2);
    expect(screen.getByRole('button', { name: 'CX control on qubit 0, step 2, target qubit 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'CX target on qubit 1, step 2, control qubit 0' })).toBeTruthy();
  });

  it('tapping the ● again cancels — nothing placed, nothing charged', async () => {
    await mount(2);
    tap('CX gate');
    tap('Qubit 0, step 1, empty: place CX control');
    tap('CX control on qubit 0, step 1: tap to cancel');
    expect(live.circuit.gates).toHaveLength(0);
    expect(strokes()).toBe(0);
    expect(spoken()).toBe('Cancelled.');
    expect(screen.getByRole('button', { name: 'Qubit 0, step 1, empty: place CX control' })).toBeTruthy();
  });

  it('E3 (GHZ-3): the CX tool stays picked for a chain — control, target, control, target', async () => {
    await mount(3);
    tap('H gate');
    tap('Qubit 0, step 1, empty: place H');
    tap('CX gate');
    tap('Qubit 0, step 2, empty: place CX control');
    tap('Qubit 1, step 2: place CX target');
    tap('Qubit 1, step 3, empty: place CX control');
    tap('Qubit 2, step 3: place CX target');
    expect(board()).toEqual([
      ['H', 0, null, null, 0],
      ['CNOT', null, 0, 1, 1],
      ['CNOT', null, 1, 2, 2],
    ]);
    expect(live.game!.state.holedIn).toBe(true);
    const editor = editorPlay(3, [[H0], [H0, CX01], [H0, CX01, CX12]]);
    expect(strokes()).toBe(editor.strokes);
    expect(strokes()).toBe(3);
  });

  it('inserts a column mid-circuit through the gap strip (1 stroke)', async () => {
    await mount(2);
    tap('X gate');
    tap('Qubit 0, step 1, empty: place X');
    tap('Qubit 0, step 2, empty: place X');
    tap('H gate');
    tap('Insert H on qubit 0 before step 2');
    expect(board()).toEqual([
      ['X', 0, null, null, 0],
      ['H', 0, null, null, 1],
      ['X', 0, null, null, 2],
    ]);
    expect(strokes()).toBe(3);
    expect(spoken()).toMatch(/^Placed H on qubit 0, step 2\. 3 strokes/);
  });

  it('a CX control put in a gap opens a provisional column; the target completes it', async () => {
    await mount(2);
    tap('H gate');
    tap('Qubit 1, step 1, empty: place H');
    tap('CX gate');
    tap('Insert CX control on qubit 0 before step 1');
    tap('Qubit 1, step 1: place CX target');
    expect(board()).toEqual([
      ['CNOT', null, 0, 1, 0],
      ['H', 1, null, null, 1],
    ]);
    expect(strokes()).toBe(2);
  });
});

describe('TapPlay — select, delete, replace, undo, clear', () => {
  it('select a gate, replace it (2 strokes), delete it (1), undo the delete (1)', async () => {
    await mount(2);
    tap('X gate');
    tap('Qubit 0, step 1, empty: place X');
    tap('X gate'); // put the tool down
    expect(strokes()).toBe(1);
    tap('X on qubit 0, step 1');
    expect(screen.getByRole('button', { name: 'X on qubit 0, step 1, selected' }).getAttribute('aria-pressed')).toBe('true');
    expect((screen.getByRole('button', { name: 'CX: cannot replace the selected gate' }) as HTMLButtonElement).disabled).toBe(true);
    tap('Replace with H');
    expect(board()).toEqual([['H', 0, null, null, 0]]);
    expect(strokes()).toBe(3); // remove X + add H
    expect(spoken()).toMatch(/^Replaced X on qubit 0, step 1 with H\. 3 strokes/);
    // The editor's same change, for parity: X then H in its cell.
    const X0: Gate = { id: 'e-x', type: 'X', qubit: 0, position: 0 };
    expect(editorPlay(2, [[X0], [H0]]).strokes).toBe(3);

    tap('Delete the selected gate');
    expect(live.circuit.gates).toHaveLength(0);
    expect(strokes()).toBe(4);
    tap('Undo the last change');
    expect(board()).toEqual([['H', 0, null, null, 0]]);
    expect(strokes()).toBe(5);
    expect(spoken()).toMatch(/^Last change undone\. 5 strokes/);
    // Undo again: back before the replace — a retype, 2 strokes.
    tap('Undo the last change');
    expect(board()).toEqual([['X', 0, null, null, 0]]);
    expect(strokes()).toBe(7);
  });

  it('Clear wipes for one stroke and ends the undo history', async () => {
    await mount(2);
    tap('X gate');
    tap('Qubit 0, step 1, empty: place X');
    tap('Qubit 1, step 1, empty: place X');
    tap('Qubit 0, step 2, empty: place X');
    expect(strokes()).toBe(3);
    tap('Clear the circuit (+1 stroke)');
    expect(live.circuit.gates).toHaveLength(0);
    expect(strokes()).toBe(4);
    expect(spoken()).toMatch(/^Circuit cleared\. 4 strokes/);
    expect((screen.getByRole('button', { name: 'Undo the last change' }) as HTMLButtonElement).disabled).toBe(true);
  });

  it('Undo, Delete, Clear are disabled with nothing to act on; Clear also once the ball is in', async () => {
    await mount(1);
    const off = (name: string) => (screen.getByRole('button', { name }) as HTMLButtonElement).disabled;
    expect(off('Undo the last change')).toBe(true);
    expect(off('Delete the selected gate')).toBe(true);
    expect(off('Clear the circuit (+1 stroke)')).toBe(true);
    tap('H gate');
    tap('Qubit 0, step 1, empty: place H');
    expect(off('Undo the last change')).toBe(false);
    expect(off('Clear the circuit (+1 stroke)')).toBe(true); // holed in
  });
});

describe('TapPlay — the empty board and a new hole (#12)', () => {
  const scoreLine = () => document.querySelector('.pk-gatebar-score')!.textContent;
  const pressed = (name: string) => screen.getByRole('button', { name }).getAttribute('aria-pressed');

  it('E1 at tee-off reads |0⟩’s real fidelity, 50 %, not 0 %', async () => {
    await mount(1);
    expect(scoreLine()).toMatch(/fidelity 50\.0%/);
    tap('X gate');
    tap('Qubit 0, step 1, empty: place X');
    expect(scoreLine()).toMatch(/fidelity 50\.0%/); // |1⟩ is as close to |+⟩ as |0⟩
    expect(spoken()).toBe('Placed X on qubit 0, step 1. 1 stroke, par 3, fidelity 50.0%.');
    tap('Clear the circuit (+1 stroke)');
    expect(scoreLine()).toMatch(/fidelity 50\.0%/);
    expect(spoken()).toBe('Circuit cleared. 2 strokes, par 3, fidelity 50.0%.');
  });

  it('Bell at tee-off reads 50 %, a gate away from it drops below, a Clear reads 50 % again', async () => {
    await mount(2);
    expect(scoreLine()).toMatch(/fidelity 50\.0%/);
    tap('X gate');
    tap('Qubit 0, step 1, empty: place X');
    expect(scoreLine()).toMatch(/fidelity 0\.0%/); // |10⟩ is orthogonal to the Bell state
    tap('Clear the circuit (+1 stroke)');
    expect(spoken()).toBe('Circuit cleared. 2 strokes, par 4, fidelity 50.0%.');
  });

  it('Next hole puts the tool down; within a hole it stays picked', async () => {
    await mount(1);
    tap('H gate');
    tap('Qubit 0, step 1, empty: place H');
    expect(live.game!.state.holedIn).toBe(true);
    expect(pressed('H gate')).toBe('true'); // still picked on the hole it played
    act(() => live.game!.advanceHole!());
    expect(live.game!.currentLevel.hole).toBe(2);
    expect(pressed('H gate')).toBe('false');
    expect(screen.getByRole('button', { name: 'Qubit 0, step 1, empty' })).toBeTruthy();
    expect(scoreLine()).toMatch(/fidelity 50\.0%/);
  });

  it('a jump to another hole drops the tool, a waiting CX control and the selection', async () => {
    await mount(2);
    tap('CX gate');
    tap('Qubit 0, step 1, empty: place CX control');
    expect(pressed('CX gate')).toBe('true');
    act(() => live.game!.jumpToHole(3));
    expect(live.game!.currentLevel.hole).toBe(3);
    expect(pressed('CX gate')).toBe('false');
    expect(screen.queryByRole('button', { name: /place CX target/ })).toBeNull();

    // A selected gate does not follow the player onto the next hole either.
    act(() => live.game!.jumpToHole(2));
    tap('H gate');
    tap('Qubit 0, step 1, empty: place H');
    tap('H gate'); // put the tool down…
    tap(/^H on qubit 0, step 1/); // …and select the gate
    expect((screen.getByRole('button', { name: 'Delete the selected gate' }) as HTMLButtonElement).disabled).toBe(false);
    act(() => live.game!.jumpToHole(4));
    expect((screen.getByRole('button', { name: 'Delete the selected gate' }) as HTMLButtonElement).disabled).toBe(true);
  });
});

describe('TapPlay — accessibility', () => {
  /** Every control of the tap-to-play group has a computed accessible name. */
  function allNamed() {
    const root = screen.getByRole('group', { name: 'Play by tapping' });
    const all = within(root).getAllByRole('button');
    const named = within(root).getAllByRole('button', { name: /\S/ });
    expect(named).toHaveLength(all.length);
    expect(root.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
    return all.length;
  }

  it.each([1, 2, 5, 18])('hole %i: every control is named — idle, with a tool, with a control waiting', async (hole) => {
    await mount(hole);
    allNamed();
    tap('H gate');
    tap('Qubit 0, step 1, empty: place H');
    allNamed(); // gap strips are live now
    if (hole > 1) {
      tap('CX gate');
      tap('Qubit 0, step 2, empty: place CX control');
      allNamed();
    }
  });

  it('speaks German (du)', async () => {
    await mount(2, 'de');
    fireEvent.click(screen.getByRole('button', { name: 'H-Gatter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Qubit 0, Schritt 1, leer: H setzen' }));
    fireEvent.click(screen.getByRole('button', { name: 'CX-Gatter' }));
    fireEvent.click(screen.getByRole('button', { name: 'Qubit 0, Schritt 2, leer: Steuerung von CX setzen' }));
    fireEvent.click(screen.getByRole('button', { name: 'Qubit 1, Schritt 2: Ziel von CX setzen' }));
    expect(
      screen.getByRole('button', { name: 'Steuerung von CX auf Qubit 0, Schritt 2, Ziel Qubit 1' }),
    ).toBeTruthy();
    expect(screen.getByRole('status').textContent).toMatch(/^CX von Qubit 0 nach Qubit 1, Schritt 2 gesetzt\. Der Ball ist drin/);
  });
});
