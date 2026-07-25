// @vitest-environment jsdom
/**
 * SC2 drift guards for the shared structural components. Each was two nearly
 * identical files (booth `bo-`/`ent-`, pocket `pk-`) before consolidation; these
 * tests assert that BOTH class-prefix bindings render the exact class names the
 * app CSS depends on, and that every parametrized per-app divergence
 * (microColData / uniformSuffix / monoKet / hideWhenEmpty / dismissGuard-free
 * booth vs pocket) is honoured. Runs once, in the pocket suite (jsdom pragma).
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { render, cleanup, fireEvent, waitFor } from '@testing-library/react';
import type { Circuit, Gate } from '@qamposer/react';
import { Histogram } from './Histogram';
import { StatePanel } from './StatePanel';
import { QasmPanel } from './QasmPanel';
import { MessageStrip } from './MessageStrip';
import { Scorecard } from './Scorecard';
import { MiniCircuit } from './MiniCircuit';
import { Celebrations } from './Celebrations';
import { initialGolfState } from '@quantum/golf';
import { randomCourse } from '@quantum/golfRandom';

afterEach(cleanup);

let seq = 0;
const g = (partial: Omit<Gate, 'id'>): Gate => ({ id: `g${seq++}`, ...partial });
const circuit = (gates: Gate[]): Circuit => ({ qubits: 5, gates });

const bell = circuit([
  g({ type: 'H', qubit: 0, position: 0 }),
  g({ type: 'CNOT', control: 0, target: 1, position: 1 }),
]);
// H on rows 0..3 → 16 equally likely outcomes → the uniform "micro" branch.
const uniform4 = circuit([0, 1, 2, 3].map((q) => g({ type: 'H', qubit: q, position: q })));

describe('Histogram (shared)', () => {
  it('renders bo- and pk- class names for the fixed 8-column (D=3) view', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(
        <Histogram circuit={bell} displayQubits={3} classPrefix={p} />,
      );
      expect(container.querySelector(`.${p}-label`)).not.toBeNull();
      expect(container.querySelector(`.${p}-h-plot`)).not.toBeNull();
      expect(container.querySelectorAll(`.${p}-h-col`).length).toBe(8);
      expect(container.querySelector(`.${p}-h-bar`)).not.toBeNull();
      expect(container.querySelector(`.${p}-h-stack`)).not.toBeNull();
      cleanup();
    }
  });

  it('renders the empty-state class when nothing is placed (D>=4)', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(
        <Histogram circuit={circuit([])} displayQubits={4} classPrefix={p} />,
      );
      expect(container.querySelector(`.${p}-h-empty`)?.textContent).toBe(
        'Place a tile to see outcomes',
      );
      cleanup();
    }
  });

  it('honours the microColData seam: booth micro cols carry no data-bits, pocket cols do', () => {
    // Booth binding: microColData=false, uniformSuffix=" possibilities".
    const booth = render(
      <Histogram
        circuit={uniform4}
        displayQubits={4}
        classPrefix="bo"
        microColData={false}
        uniformSuffix=" possibilities"
      />,
    );
    expect(booth.container.querySelector('.bo-h-plot.is-micro')).not.toBeNull();
    expect(booth.container.querySelectorAll('.bo-h-col[data-bits]').length).toBe(0);
    expect(booth.container.querySelector('.bo-h-note')?.textContent).toMatch(
      /equally likely possibilities$/,
    );
    cleanup();

    // Pocket binding: microColData=true, uniformSuffix="".
    const pocket = render(
      <Histogram
        circuit={uniform4}
        displayQubits={4}
        classPrefix="pk"
        microColData={true}
        uniformSuffix=""
      />,
    );
    expect(pocket.container.querySelectorAll('.pk-h-col[data-bits]').length).toBe(16);
    expect(pocket.container.querySelector('.pk-h-note')?.textContent).toMatch(
      /equally likely$/,
    );
  });
});

describe('Histogram (shared) — paired ideal + noisy series', () => {
  // Build a 32-length physical probability vector (statevector basis ordering).
  const noisyVec = (entries: Record<number, number>): number[] => {
    const v = new Array<number>(32).fill(0);
    for (const [i, p] of Object.entries(entries)) v[+i] = p;
    return v;
  };
  // Bell on q0/q1, D=5: ideal peaks are 00000 (index 0) and 11000 (index 3, q0+q1).
  // 00100 (index 4, a q2 flip) is ideal-zero — a noisy-only leakage outcome.
  const bellNoisy = noisyVec({ 0: 0.4, 3: 0.4, 4: 0.06, 1: 0.05, 2: 0.05, 5: 0.0001 });

  it('single-series rendering is unchanged when no noisy prop is given', () => {
    const { container } = render(<Histogram circuit={bell} displayQubits={5} classPrefix="pk" />);
    expect(container.querySelector('.pk-h-bar--noisy')).toBeNull();
    expect(container.querySelector('.pk-h-legend')).toBeNull();
    expect(container.querySelector('.pk-h-pair')).toBeNull();
  });

  it('renders paired bars over the UNION of ideal peaks and noisy leakage', () => {
    const { container } = render(
      <Histogram circuit={bell} displayQubits={5} classPrefix="pk" noisy={bellNoisy} />,
    );
    // A noisy bar per column + the pair wrapper.
    expect(container.querySelector('.pk-h-bar--noisy')).not.toBeNull();
    expect(container.querySelector('.pk-h-pair')).not.toBeNull();
    const bits = [...container.querySelectorAll('.pk-h-col[data-bits]')].map((c) =>
      c.getAttribute('data-bits'),
    );
    // Both ideal peaks are present…
    expect(bits).toContain('00000');
    expect(bits).toContain('11000');
    // …and so is the ideal-zero, noisy-only leakage outcome (the whole point).
    expect(bits).toContain('00100');
    // A noisy outcome below the noisy floor (0.0001) is NOT surfaced.
    expect(bits).not.toContain('10100');
  });

  it('renders the legend only in paired mode, with prop-driven labels', () => {
    const { container } = render(
      <Histogram
        circuit={bell}
        displayQubits={5}
        classPrefix="pk"
        noisy={bellNoisy}
        idealLabel="perfect"
        noisyLabel="on hardware"
      />,
    );
    const legend = container.querySelector('.pk-h-legend');
    expect(legend).not.toBeNull();
    expect(legend?.textContent).toContain('perfect');
    expect(legend?.textContent).toContain('on hardware');
    expect(container.querySelector('.pk-h-swatch--noisy')).not.toBeNull();
  });

  it('D=3 fixed axis lights a noisy-only leakage column (not a dim stub)', () => {
    // 00100 (index 4) is ideal-zero for Bell but carries noisy weight → not dim.
    const { container } = render(
      <Histogram circuit={bell} displayQubits={3} classPrefix="pk" noisy={bellNoisy} />,
    );
    expect(container.querySelectorAll('.pk-h-col').length).toBe(8);
    expect(container.querySelector('.pk-h-bar--noisy')).not.toBeNull();
    expect(container.querySelector('.pk-h-legend')).not.toBeNull();
    const leak = container.querySelector('.pk-h-col[data-bits="001"]');
    expect(leak?.className).not.toContain('is-dim');
  });

  it('with noise on, an empty circuit still renders (readout leakage), not the placeholder', () => {
    const { container } = render(
      <Histogram
        circuit={circuit([])}
        displayQubits={5}
        classPrefix="pk"
        noisy={noisyVec({ 0: 0.9, 1: 0.03, 2: 0.03, 4: 0.02 })}
      />,
    );
    expect(container.querySelector('.pk-h-empty')).toBeNull();
    expect(container.querySelector('.pk-h-pair')).not.toBeNull();
    const bits = [...container.querySelectorAll('.pk-h-col[data-bits]')].map((c) =>
      c.getAttribute('data-bits'),
    );
    expect(bits).toContain('00000');
  });
});

describe('StatePanel (shared)', () => {
  it('renders bo-/pk- class names and the three stats', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(<StatePanel circuit={bell} classPrefix={p} />);
      expect(container.querySelector(`.${p}-label`)?.textContent).toBe('State');
      expect(container.querySelectorAll(`.${p}-stat`).length).toBe(3);
      // qubits touched = 2 (H on q0, CNOT touches q0,q1); gates = 2; columns = 2.
      const stats = container.querySelectorAll(`.${p}-stat b`);
      expect([...stats].map((b) => b.textContent)).toEqual(['2', '2', '2']);
      cleanup();
    }
  });
});

describe('QasmPanel (shared)', () => {
  const lines = ['OPENQASM 2.0;', 'qreg q[5];', 'h q[0];', 'cx q[0],q[1];'];

  it('renders bo-/pk- class names, keyword + tint classes', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(<QasmPanel lines={lines} classPrefix={p} />);
      expect(container.querySelector(`.${p}-label`)?.textContent).toBe('OpenQASM 2.0');
      expect(container.querySelector(`.${p}-well.${p}-qasm`)).not.toBeNull();
      // OPENQASM / qreg lines are keyword-classed; gate lines are tinted.
      expect(container.querySelectorAll('.kw').length).toBe(2);
      cleanup();
    }
  });

  it('honours hideWhenEmpty: booth hides an empty panel, pocket renders it', () => {
    const hidden = render(<QasmPanel lines={[]} classPrefix="bo" hideWhenEmpty />);
    expect(hidden.container.firstChild).toBeNull();
    cleanup();
    const shown = render(<QasmPanel lines={[]} classPrefix="pk" />);
    expect(shown.container.querySelector('.pk-label')).not.toBeNull();
  });
});

describe('MessageStrip (shared)', () => {
  it('renders the ent-/pk- strip classes and shows the first message immediately', () => {
    for (const p of ['ent', 'pk'] as const) {
      const { container } = render(
        <MessageStrip message={{ text: 'Bell pair!', token: 1 }} classPrefix={p} />,
      );
      const text = container.querySelector(`.${p}-strip__text`);
      expect(container.querySelector(`.${p}-strip`)).not.toBeNull();
      expect(text?.textContent).toBe('Bell pair!');
      expect(text?.className).toContain('is-visible');
      cleanup();
    }
  });
});

describe('Scorecard (shared)', () => {
  it('renders bo-/pk- class names for the hole-1 scorecard with all 18 chips', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(
        <Scorecard state={initialGolfState()} circuit={bell} classPrefix={p} />,
      );
      expect(container.querySelector(`.${p}-golf`)).not.toBeNull();
      expect(container.querySelector(`.${p}-golf-ket`)).not.toBeNull();
      // The full 18-hole course strip (E1..E5, M1..M5, D1..D5, X1/X3/X5).
      expect(container.querySelectorAll(`.${p}-golf-chip`).length).toBe(18);
      cleanup();
    }
  });

  it('shows the hole’s cumulative strokes, not the gates on the board (#68)', () => {
    // `bell` is a 2-gate circuit, but the hole has cost 5 strokes so far.
    const state = { ...initialGolfState(), strokes: 5 };
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    const stats = Array.from(container.querySelectorAll('.pk-stat')).map((n) => n.textContent);
    expect(stats).toContain('strokes 5');
  });

  it('honours the monoKet seam: pocket tints the ket, the booth does not', () => {
    const booth = render(
      <Scorecard state={initialGolfState()} circuit={bell} classPrefix="bo" />,
    );
    expect(booth.container.querySelector('.bo-golf-ket')?.className).toBe('bo-golf-ket');
    cleanup();
    const pocket = render(
      <Scorecard state={initialGolfState()} circuit={bell} classPrefix="pk" monoKet />,
    );
    expect(pocket.container.querySelector('.pk-golf-ket')?.className).toBe('pk-golf-ket pk-mono');
  });

  it('renders a random round through the same layout, with a course chip (#70)', () => {
    const state = initialGolfState({}, 'random', 4242);
    const hole = randomCourse(4242)[0];
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    expect(container.querySelector('.pk-golf-random')?.textContent).toBe('Random round');
    expect(container.querySelector('.pk-golf-name')?.textContent).toBe(`E1 — ${hole.name}`);
    expect(container.querySelector('.pk-golf-ket')?.textContent).toBe(`Target${hole.targetKet}`);
    const stats = Array.from(container.querySelectorAll('.pk-stat')).map((n) => n.textContent);
    expect(stats).toContain(`par ${hole.par}`);
    // Same 18-chip strip — the structure is shared with the classic course.
    expect(container.querySelectorAll('.pk-golf-chip').length).toBe(18);
  });

  it('draws the hole’s solution only after a hole-in, and only on request (#71)', () => {
    for (const p of ['bo', 'pk'] as const) {
      // Mid-hole: nothing to reveal, because the hole is not in yet.
      const playing = render(
        <Scorecard state={initialGolfState()} circuit={bell} classPrefix={p} />,
      );
      expect(playing.container.querySelector(`.${p}-golf-solution-btn`)).toBeNull();
      cleanup();

      // Holed in on E2 (Bell): the toggle appears, collapsed.
      const state = { ...initialGolfState(), levelIndex: 1, holedIn: true, strokes: 4 };
      const { container } = render(<Scorecard state={state} circuit={bell} classPrefix={p} />);
      const btn = container.querySelector(`.${p}-golf-solution-btn`) as HTMLButtonElement;
      expect(btn.textContent).toBe('Show solution');
      expect(btn.getAttribute('aria-expanded')).toBe('false');
      expect(container.querySelector(`.${p}-golf-solution`)).toBeNull();

      // Expanded: the reference path DRAWN — H on q0, then a CX down to q1.
      fireEvent.click(btn);
      const svg = container.querySelector(`.${p}-golf-solution .${p}-mini-circ`);
      expect(svg).not.toBeNull();
      expect(svg?.querySelectorAll(`.${p}-mini-circ-wire`).length).toBe(2);
      expect(
        Array.from(svg!.querySelectorAll(`.${p}-mini-circ-gate`)).map((n) => n.textContent),
      ).toEqual(['H']);
      expect(svg?.querySelectorAll(`.${p}-mini-circ-dot`).length).toBe(1);
      expect(svg?.querySelectorAll(`.${p}-mini-circ-cross`).length).toBe(1);
      expect(btn.textContent).toBe('Hide solution');
      // The 18-hole strip is untouched.
      expect(container.querySelectorAll(`.${p}-golf-chip`).length).toBe(18);

      // Collapses again on the next tap.
      fireEvent.click(btn);
      expect(container.querySelector(`.${p}-golf-solution`)).toBeNull();
      cleanup();
    }
  });

  it('draws a generated hole’s generator on the random course (#71)', async () => {
    const state = { ...initialGolfState({}, 'random', 4242), holedIn: true, strokes: 9 };
    const generated = randomCourse(4242)[0];
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    fireEvent.click(container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement);
    const svg = container.querySelector('.pk-golf-solution .pk-mini-circ');
    expect(svg).not.toBeNull();
    // E1 is a 1-qubit hole, so its generator draws on exactly one wire.
    expect(svg?.querySelectorAll('.pk-mini-circ-wire').length).toBe(generated.qubits);
    // Every generator gate is drawn (a 1-qubit hole has no controlled gates).
    expect(svg?.querySelectorAll('.pk-mini-circ-box').length).toBe(
      generated.solution!.gates.length,
    );
    // Let the optimal search (#72) settle before the card unmounts, so its
    // re-render lands inside the test rather than after it.
    await waitFor(() => expect(container.querySelector('.pk-golf-sol-label')).not.toBeNull());
  });

  it('the reveal is inert: it cannot touch the board or the score (#68)', () => {
    const state = { ...initialGolfState(), levelIndex: 1, holedIn: true, strokes: 7 };
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    const strokesBefore = container.querySelector('.pk-stat')?.parentElement?.textContent;
    fireEvent.click(container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement);
    expect(container.querySelector('.pk-stat')?.parentElement?.textContent).toBe(strokesBefore);
    // The drawing takes no pointer events, so tap-to-inspect and the editor
    // never see gates that only exist as an illustration.
    expect((container.querySelector('.pk-mini-circ') as SVGElement).style.pointerEvents).toBe(
      'none',
    );
    expect(state.strokes).toBe(7);
  });

  it('promotes a minimal stored solution to "Solution — optimal" (#72)', async () => {
    // E2 (Bell) really is minimal in two gates, and proving it is instant.
    const state = { ...initialGolfState(), levelIndex: 1, holedIn: true, strokes: 4 };
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    fireEvent.click(container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement);
    await waitFor(() =>
      expect(container.querySelector('.pk-golf-sol-label')?.textContent).toBe(
        'Solution — optimal',
      ),
    );
    // One drawing only: there is nothing shorter to show.
    expect(container.querySelectorAll('.pk-golf-solution').length).toBe(1);
  });

  it('draws a shorter answer under the dealt one when it finds one (#72)', async () => {
    // A generated hole's answer is its generator, which is essentially never
    // minimal — this is where the search earns its keep.
    const state = { ...initialGolfState({}, 'random', 4242), holedIn: true, strokes: 9 };
    const dealt = randomCourse(4242)[0];
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    fireEvent.click(container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement);
    await waitFor(() => expect(container.querySelectorAll('.pk-golf-solution').length).toBe(2));

    const labels = Array.from(container.querySelectorAll('.pk-golf-sol-label')).map(
      (n) => n.textContent,
    );
    expect(labels[0]).toBe('Dealt solution');
    expect(labels[1]).toMatch(/^Optimal \(\d+ gates?\)$/);

    // The optimal drawing really is shorter than the dealt one.
    const boxes = (i: number) =>
      container.querySelectorAll('.pk-golf-solution')[i].querySelectorAll('.pk-mini-circ-box')
        .length;
    expect(boxes(1)).toBeLessThan(dealt.solution!.gates.length);
    expect(boxes(1)).toBeGreaterThan(0);
  });

  it('says nothing when the search cannot decide, and never blocks the reveal', () => {
    // Before any result lands, the card looks exactly as it did pre-#72: the
    // stored solution, unlabelled. An exhausted budget leaves it that way.
    const state = { ...initialGolfState(), levelIndex: 17, holedIn: true, strokes: 12 };
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    fireEvent.click(container.querySelector('.pk-golf-solution-btn') as HTMLButtonElement);
    expect(container.querySelectorAll('.pk-golf-solution').length).toBe(1);
    expect(container.querySelector('.pk-golf-sol-label')).toBeNull();
    expect(container.querySelector('.pk-mini-circ')).not.toBeNull();
  });

  it('hides the reveal on the completed-course summary (no hole is in play)', () => {
    const state = { ...initialGolfState(), levelIndex: 17, complete: true };
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    expect(container.querySelector('.pk-golf-solution-btn')).toBeNull();
  });

  it('labels the round rows E / M / D / X — the extra row is not another E (#74)', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(
        <Scorecard state={initialGolfState()} circuit={bell} classPrefix={p} />,
      );
      expect(
        Array.from(container.querySelectorAll(`.${p}-golf-round`)).map((n) => n.textContent),
      ).toEqual(['E', 'M', 'D', 'X']);
      cleanup();
    }
  });

  it('shows each completed hole’s result on its chip, coloured by score (#74)', () => {
    // E1 par 3 in 1 (eagle), E2 par 4 in 3 (birdie), E3 par 5 in 5 (par),
    // E4 par 6 in 9 (over). E5 is untouched.
    const state = initialGolfState({ 1: 1, 2: 3, 3: 5, 4: 9 });
    const { container } = render(<Scorecard state={state} circuit={bell} classPrefix="pk" />);
    const chips = Array.from(container.querySelectorAll('.pk-golf-chip')).slice(0, 5);
    const read = (i: number) => ({
      best: chips[i].querySelector('.pk-golf-chip-best')?.textContent,
      vsPar: chips[i].querySelector('.pk-golf-chip-vspar')?.textContent ?? null,
      kind: ['eagle', 'birdie', 'par', 'over'].find((k) =>
        chips[i].classList.contains(`pk-golf-chip--${k}`),
      ),
    });
    expect(read(0)).toEqual({ best: '1', vsPar: '−2', kind: 'eagle' });
    expect(read(1)).toEqual({ best: '3', vsPar: '−1', kind: 'birdie' });
    expect(read(2)).toEqual({ best: '5', vsPar: 'E', kind: 'par' });
    expect(read(3)).toEqual({ best: '9', vsPar: '+3', kind: 'over' });
    // An unplayed hole is unchanged: a dot, no vs-par, no score colour.
    expect(read(4)).toEqual({ best: '·', vsPar: null, kind: undefined });
    expect(chips[4].classList.contains('is-done')).toBe(false);
    // The tooltip carries the same result in words.
    expect(chips[0].getAttribute('title')).toBe('E1 · Superposition · par 3 · best 1 (−2)');
    expect(chips[4].getAttribute('title')).toBe('E5 · GHZ-5 · par 7');
  });

  it('leaves the classic card free of any course chip', () => {
    const { container } = render(
      <Scorecard state={initialGolfState()} circuit={bell} classPrefix="pk" />,
    );
    expect(container.querySelector('.pk-golf-random')).toBeNull();
  });
});

describe('MiniCircuit (shared)', () => {
  // H q0 ; CX q0→q1 ; CZ q1→q2 (a lettered target) ; RZ(π/2) q2 — one of each
  // shape the drawing knows, at four occupied positions.
  const mixed = circuit([
    g({ type: 'H', qubit: 0, position: 0 }),
    g({ type: 'CNOT', control: 0, target: 1, position: 1 }),
    g({ type: 'CZ', control: 1, target: 2, position: 2 }),
    g({ type: 'RZ', qubit: 2, parameter: Math.PI / 2, position: 3 }),
  ]);

  it('draws a wire + label per qubit and the right shape per gate', () => {
    for (const p of ['bo', 'pk'] as const) {
      const { container } = render(<MiniCircuit circuit={mixed} n={3} classPrefix={p} />);
      const svg = container.querySelector(`.${p}-mini-circ`)!;
      expect(svg.querySelectorAll(`.${p}-mini-circ-wire`).length).toBe(3);
      expect(
        Array.from(svg.querySelectorAll(`.${p}-mini-circ-label`)).map((n) => n.textContent),
      ).toEqual(['q0', 'q1', 'q2']);
      // Boxes: H, the CZ's lettered target, and the rotation. CX draws a ⊕.
      expect(
        Array.from(svg.querySelectorAll(`.${p}-mini-circ-gate`)).map((n) => n.textContent),
      ).toEqual(['H', 'Z', 'RZ']);
      expect(svg.querySelectorAll(`.${p}-mini-circ-box`).length).toBe(3);
      expect(svg.querySelectorAll(`.${p}-mini-circ-dot`).length).toBe(2); // CX + CZ controls
      expect(svg.querySelectorAll(`.${p}-mini-circ-link`).length).toBe(2);
      expect(svg.querySelectorAll(`.${p}-mini-circ-target`).length).toBe(1); // only the CX
      expect(svg.querySelectorAll(`.${p}-mini-circ-cross`).length).toBe(1);
      // A rotation carries its angle, typeset like the inspect popovers.
      expect(svg.querySelector(`.${p}-mini-circ-angle`)?.textContent).toBe('0.50π');
      cleanup();
    }
  });

  it('colours by gate family, matching the editor and the printed tiles', () => {
    const { container } = render(<MiniCircuit circuit={mixed} n={3} classPrefix="pk" />);
    const fills = Array.from(container.querySelectorAll('.pk-mini-circ-box')).map((n) =>
      n.getAttribute('fill'),
    );
    expect(fills).toEqual(['#fa4d56', '#33b1ff', '#33b1ff']); // H red, Z/RZ cyan
    expect(container.querySelector('.pk-mini-circ-dot')?.getAttribute('fill')).toBe('#002d9c');
  });

  it('draws a CCX as two control dots on one link into a ⊕', () => {
    const ccx = circuit([g({ type: 'CCX', control: 0, control2: 1, target: 2, position: 0 })]);
    const { container } = render(<MiniCircuit circuit={ccx} n={3} classPrefix="pk" />);
    expect(container.querySelectorAll('.pk-mini-circ-dot').length).toBe(2);
    expect(container.querySelectorAll('.pk-mini-circ-link').length).toBe(1);
    expect(container.querySelectorAll('.pk-mini-circ-target').length).toBe(1);
    expect(container.querySelectorAll('.pk-mini-circ-cross').length).toBe(1);
    expect(container.querySelectorAll('.pk-mini-circ-box').length).toBe(0);
  });

  it('compacts sparse columns and never clips a gate off the drawing', () => {
    // Positions 0/4/9 draw as three ADJACENT columns …
    const sparse = circuit([
      g({ type: 'X', qubit: 0, position: 0 }),
      g({ type: 'X', qubit: 0, position: 4 }),
      g({ type: 'X', qubit: 0, position: 9 }),
    ]);
    const { container } = render(<MiniCircuit circuit={sparse} n={1} classPrefix="pk" />);
    const xs = Array.from(container.querySelectorAll('.pk-mini-circ-box')).map((n) =>
      Number(n.getAttribute('x')),
    );
    expect(xs[1] - xs[0]).toBe(30);
    expect(xs[2] - xs[1]).toBe(30);
    cleanup();

    // … and a gate above the asked-for wire count grows the drawing, not clips it.
    const high = circuit([g({ type: 'H', qubit: 4, position: 0 })]);
    const grown = render(<MiniCircuit circuit={high} n={2} classPrefix="pk" />);
    expect(grown.container.querySelectorAll('.pk-mini-circ-wire').length).toBe(5);
  });
});

describe('Celebrations (shared)', () => {
  it('renders the ent-/pk- overlay + canvas classes', () => {
    for (const p of ['ent', 'pk'] as const) {
      const { container } = render(
        <Celebrations
          celebration={null}
          classPrefix={p}
          particleBudget={() => 100}
          maxParticles={100}
        />,
      );
      expect(container.querySelector(`.${p}-celebrate`)).not.toBeNull();
      expect(container.querySelector(`.${p}-celebrate__canvas`)).not.toBeNull();
      cleanup();
    }
  });

  it('renders the banner with prefix-scoped kind + phase classes on a fire', () => {
    // Stub rAF/canvas so the confetti loop is inert under jsdom.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    try {
      const { container } = render(
        <Celebrations
          celebration={{ kind: 'bell', k: 2, token: 1 }}
          classPrefix="pk"
          particleBudget={() => 100}
          maxParticles={100}
        />,
      );
      const banner = container.querySelector('.pk-banner');
      expect(banner).not.toBeNull();
      expect(banner?.className).toContain('pk-banner--bell');
      expect(banner?.className).toContain('pk-banner--in');
      expect(banner?.textContent).toBe('ENTANGLEMENT!');
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
