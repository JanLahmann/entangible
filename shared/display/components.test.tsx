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
import { render, cleanup } from '@testing-library/react';
import type { Circuit, Gate } from '@qamposer/react';
import { Histogram } from './Histogram';
import { StatePanel } from './StatePanel';
import { QasmPanel } from './QasmPanel';
import { MessageStrip } from './MessageStrip';
import { Scorecard } from './Scorecard';
import { Celebrations } from './Celebrations';
import { initialGolfState } from '@quantum/golf';

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
