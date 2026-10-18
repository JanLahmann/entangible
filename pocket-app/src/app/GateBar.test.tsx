// @vitest-environment jsdom
/**
 * The golf gate bar (tap to play), driven the way the shells drive it: a
 * `ManualEditSource` feeding `useGolfGame.step`, with the bar's `onChange`
 * being the editor's own `setFromEditor`.
 *
 * Covered: the clubs and their accessible names on 1-, 2- and 5-qubit holes;
 * the qubit pickers (limited to the hole, control ≠ target, the swap, arrow
 * keys); a tap holing in E1 and E2 with exactly the strokes the equivalent
 * editor change costs; Undo and Clear costing what a delete and the wipe
 * cost; the spoken status; and that every control has an accessible name.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { act, cleanup, fireEvent, render, renderHook, screen, within } from '@testing-library/react';
import { useEffect, useRef, useState } from 'react';
import type { Circuit } from '@qamposer/react';
import { LangProvider } from '@shared/i18n';
import { ManualEditSource } from '../sources/ManualEditSource';
import { GateBar } from './GateBar';
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
  return (
    <GateBar game={game} circuit={circuit} onChange={(c) => sourceRef.current.setFromEditor(c)} />
  );
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

const tap = (name: string) => fireEvent.click(screen.getByRole('button', { name }));

/** The same hole played through `step` with the circuits the editor emits. */
function editorStrokes(hole: number, boards: Circuit[]) {
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
  for (const b of boards) {
    act(() => hook.result.current.step(b));
    hook.rerender({ ...opts, circuit: b });
  }
  return hook.result.current.state;
}

describe('GateBar — clubs and names', () => {
  it('a 1-qubit hole: its clubs on qubit 0, CX shown but not playable, no picker', async () => {
    await mount(1);
    expect(screen.getByRole('button', { name: 'Add X to qubit 0' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add H to qubit 0' })).toBeTruthy();
    const cx = screen.getByRole('button', { name: 'CX needs two qubits — not on this hole' });
    expect((cx as HTMLButtonElement).disabled).toBe(true);
    expect(screen.queryByRole('radiogroup')).toBeNull();
    expect(document.querySelectorAll('.pk-gatebar-club')).toHaveLength(3);
  });

  it('a 2-qubit hole: control + target pickers of two qubits each', async () => {
    await mount(2);
    const control = screen.getByRole('radiogroup', { name: 'Control qubit for the next gate' });
    const target = screen.getByRole('radiogroup', { name: 'Target qubit for two-qubit gates' });
    expect(within(control).getAllByRole('radio')).toHaveLength(2);
    expect(within(target).getAllByRole('radio')).toHaveLength(2);
    expect(screen.getByRole('button', { name: 'Add CX, control qubit 0, target qubit 1' })).toBeTruthy();
    // The control's own wire is not a target.
    expect(within(target).getByRole('radio', { name: 'qubit 0' }).getAttribute('aria-disabled')).toBe('true');
  });

  it('picking the target as control swaps the two (control ≠ target, always)', async () => {
    await mount(2);
    const control = screen.getByRole('radiogroup', { name: 'Control qubit for the next gate' });
    fireEvent.click(within(control).getByRole('radio', { name: 'qubit 1' }));
    expect(screen.getByRole('button', { name: 'Add CX, control qubit 1, target qubit 0' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add H to qubit 1' })).toBeTruthy();
    expect(within(control).getByRole('radio', { name: 'qubit 1' }).getAttribute('aria-checked')).toBe('true');
  });

  it('a 5-qubit hole offers q0…q4; arrow keys move the pick, skipping the control', async () => {
    await mount(5);
    const control = screen.getByRole('radiogroup', { name: 'Control qubit for the next gate' });
    const target = screen.getByRole('radiogroup', { name: 'Target qubit for two-qubit gates' });
    expect(within(control).getAllByRole('radio').map((r) => r.textContent)).toEqual([
      'q0',
      'q1',
      'q2',
      'q3',
      'q4',
    ]);
    // q0 → q1 lands on the target (q1), which swaps it to q0; then q2.
    fireEvent.keyDown(control, { key: 'ArrowRight' });
    fireEvent.keyDown(control, { key: 'ArrowRight' });
    expect(screen.getByRole('button', { name: 'Add H to qubit 2' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Add CX, control qubit 2, target qubit 0' })).toBeTruthy();
    // ArrowLeft wraps q0 → q4, then q3, then skips the control (q2) to q1.
    fireEvent.keyDown(target, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: 'Add CX, control qubit 2, target qubit 4' })).toBeTruthy();
    fireEvent.keyDown(target, { key: 'ArrowLeft' });
    fireEvent.keyDown(target, { key: 'ArrowLeft' });
    expect(screen.getByRole('button', { name: 'Add CX, control qubit 2, target qubit 1' })).toBeTruthy();
    // Only the checked radio is a tab stop.
    expect(within(control).getAllByRole('radio').filter((r) => r.tabIndex === 0)).toHaveLength(1);
  });

  it('speaks German (du) when the page does', async () => {
    await mount(2, 'de');
    expect(screen.getByRole('button', { name: 'H auf Qubit 0 setzen' })).toBeTruthy();
    expect(
      screen.getByRole('button', { name: 'CX setzen, Steuer-Qubit 0, Ziel-Qubit 1' }),
    ).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Letztes Gatter zurücknehmen' })).toBeTruthy();
  });
});

describe('GateBar — playing by taps scores like the editor', () => {
  it('H on q0 holes E1 in one stroke — the same as the editor’s H', async () => {
    await mount(1);
    tap('Add H to qubit 0');
    const g = live.game!;
    expect(live.circuit.gates.map(({ type, qubit, position }) => ({ type, qubit, position }))).toEqual([
      { type: 'H', qubit: 0, position: 0 },
    ]);
    expect(g.state.holedIn).toBe(true);
    const editor = editorStrokes(1, [
      { qubits: 5, gates: [{ id: 'e1', type: 'H', qubit: 0, position: 0 }] } as Circuit,
    ]);
    expect(editor.holedIn).toBe(true);
    expect(g.state.strokes).toBe(editor.strokes);
    expect(g.state.strokes).toBe(1);
    expect(screen.getByRole('status').textContent).toBe('H on qubit 0. The ball is in — EAGLE!');
  });

  it('H then CX holes the Bell pair (E2) in two strokes, like the editor', async () => {
    await mount(2);
    tap('Add H to qubit 0');
    expect(screen.getByRole('status').textContent).toBe(
      'H on qubit 0. 1 stroke, par 4, fidelity 25.0%.',
    );
    tap('Add CX, control qubit 0, target qubit 1');
    const g = live.game!;
    expect(g.state.holedIn).toBe(true);
    const h = { id: 'e1', type: 'H', qubit: 0, position: 0 } as const;
    const cx = { id: 'e2', type: 'CNOT', control: 0, target: 1, position: 1 } as const;
    const editor = editorStrokes(2, [
      { qubits: 5, gates: [h] } as Circuit,
      { qubits: 5, gates: [h, cx] } as Circuit,
    ]);
    expect(g.state.strokes).toBe(editor.strokes);
    expect(g.state.strokes).toBe(2);
  });

  it('Undo takes the last gate back for one stroke (a delete), Clear wipes for one', async () => {
    await mount(2);
    tap('Add X to qubit 0');
    tap('Undo last gate');
    expect(live.circuit.gates).toHaveLength(0);
    expect(live.game!.state.strokes).toBe(2);
    expect(screen.getByRole('status').textContent).toBe(
      'Removed X from qubit 0. 2 strokes, par 4, fidelity 0.0%.',
    );

    const control = screen.getByRole('radiogroup', { name: 'Control qubit for the next gate' });
    tap('Add X to qubit 0');
    fireEvent.click(within(control).getByRole('radio', { name: 'qubit 1' }));
    tap('Add H to qubit 1');
    fireEvent.click(within(control).getByRole('radio', { name: 'qubit 0' }));
    tap('Add X to qubit 0');
    expect(live.game!.state.strokes).toBe(5);
    tap('Clear the circuit (+1 stroke)');
    expect(live.circuit.gates).toHaveLength(0);
    expect(live.game!.state.strokes).toBe(6);
    expect(screen.getByRole('status').textContent).toMatch(/^Circuit cleared\. 6 strokes/);
  });

  it('Undo follows tap order, not columns', async () => {
    await mount(2);
    tap('Add H to qubit 0');
    tap('Add H to qubit 0');
    const control = screen.getByRole('radiogroup', { name: 'Control qubit for the next gate' });
    fireEvent.click(within(control).getByRole('radio', { name: 'qubit 1' }));
    tap('Add X to qubit 1'); // column 0 — but the last tap
    tap('Undo last gate');
    expect(live.circuit.gates.map((x) => [x.type, x.qubit])).toEqual([
      ['H', 0],
      ['H', 0],
    ]);
  });

  it('Undo and Clear are disabled on an empty board; Clear also once the ball is in', async () => {
    await mount(1);
    const undo = screen.getByRole('button', { name: 'Undo last gate' }) as HTMLButtonElement;
    const clear = screen.getByRole('button', { name: 'Clear the circuit (+1 stroke)' }) as HTMLButtonElement;
    expect(undo.disabled).toBe(true);
    expect(clear.disabled).toBe(true);
    tap('Add H to qubit 0');
    expect(undo.disabled).toBe(false);
    expect(clear.disabled).toBe(true); // holed in: Next hole is how you leave
  });
});

describe('GateBar — accessibility', () => {
  it.each([1, 2, 5, 16])('hole %i: every control has an accessible name', async (hole) => {
    await mount(hole);
    const bar = screen.getByRole('group', { name: 'Place gates' });
    // Testing Library filters by the COMPUTED accessible name (the same
    // algorithm assistive tech uses): every control of each role must match a
    // non-blank name.
    let total = 0;
    for (const role of ['button', 'radio', 'radiogroup'] as const) {
      const all = within(bar).queryAllByRole(role);
      const named = within(bar).queryAllByRole(role, { name: /\S/ });
      expect(named, role).toHaveLength(all.length);
      total += all.length;
    }
    expect(total).toBeGreaterThan(4);
    // One polite live region.
    expect(bar.querySelectorAll('[aria-live="polite"]')).toHaveLength(1);
  });
});
