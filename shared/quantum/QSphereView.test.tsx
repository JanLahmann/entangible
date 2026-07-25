// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { QSphereView } from './QSphereView';
import { ghzState, zeroState, type StateVector } from './statevector';

afterEach(cleanup);

/** A single-basis-state vector — index `i` with amplitude 1. */
function basisState(i: number): StateVector {
  const s = zeroState();
  s[0] = { re: 0, im: 0 };
  s[i] = { re: 1, im: 0 };
  return s;
}

const attrs = (root: HTMLElement, sel: string, attr: string) =>
  Array.from(root.querySelectorAll(sel)).map((e) => e.getAttribute(attr));

describe('QSphereView', () => {
  it('sizes nodes by probability (populated nodes larger than faint lattice dots)', () => {
    // Bell pair on {0,1}: two populated basis states (p=0.5), the rest ~0.
    const { container } = render(<QSphereView statevector={ghzState([0, 1])} classPrefix="pk" />);
    const dots = Array.from(container.querySelectorAll('.pk-qs-dot')) as SVGCircleElement[];
    expect(dots.length).toBe(32);

    const radii = dots.map((d) => Number(d.getAttribute('r'))).sort((a, b) => b - a);
    // The two populated nodes are clearly larger than the faint (~1px) dots.
    expect(radii[0]).toBeGreaterThan(5);
    expect(radii[1]).toBeGreaterThan(5);
    expect(radii[2]).toBeLessThan(2); // first faint lattice dot
    expect(radii.filter((r) => r <= 1.01).length).toBe(30);
  });

  it('offers a rewind-arrow reset-orientation button', () => {
    render(<QSphereView statevector={ghzState([0, 1])} classPrefix="bo" />);
    const btn = screen.getByRole('button', { name: 'Reset orientation' });
    expect(btn).toBeTruthy();
    // Clicking is a no-op smoke (orientation is internal) — must not throw.
    fireEvent.click(btn);
  });

  it('renders the phase color-wheel legend', () => {
    const { container } = render(<QSphereView statevector={ghzState([0, 1])} classPrefix="pk" />);
    expect(container.querySelector('.pk-qs-legend')).not.toBeNull();
  });
});

describe('QSphereView target ghosts (#58)', () => {
  // (|00000⟩+|11111⟩)/√2: the two poles, so the centroid is zero and the view
  // keeps its default home — one ghost lands on each hemisphere.
  const ghz5 = ghzState([0, 1, 2, 3, 4]);

  it('rings every populated target node, sized by TARGET probability', () => {
    const { container } = render(
      <QSphereView statevector={zeroState()} targetState={ghz5} classPrefix="pk" />,
    );
    const radii = attrs(container, '.pk-qs-target-ring', 'r').map(Number);
    expect(radii).toHaveLength(2); // only the 2 populated target nodes of 32
    // MIN_NODE + (MAX_NODE - MIN_NODE) · p, the live-node mapping, at p = 0.5.
    for (const r of radii) expect(r).toBeCloseTo(2.5 + 10.5 * 0.5, 6);
    // Each ring carries a phase tick.
    expect(container.querySelectorAll('.pk-qs-target-tick')).toHaveLength(2);
  });

  it('keeps far-hemisphere ghosts at FULL opacity (unlike the nodes)', () => {
    const { container } = render(
      <QSphereView statevector={zeroState()} targetState={ghz5} classPrefix="pk" />,
    );
    // The nodes still dim on the far side …
    const nodeOpacities = attrs(container, '.pk-qs-node', 'opacity').map(Number);
    expect(nodeOpacities.some((o) => o < 1)).toBe(true);
    // … the ghosts never do, on either side.
    const ghosts = Array.from(container.querySelectorAll('.pk-qs-target'));
    expect(ghosts).toHaveLength(2);
    for (const g of ghosts) expect(g.getAttribute('opacity')).toBeNull();
    // One of them is drawn BEFORE the disc, i.e. it is a far-hemisphere ghost.
    const kids = Array.from(container.querySelector('.pk-qs-svg')!.children);
    const disc = kids.findIndex((e) => e.classList.contains('pk-qs-disc'));
    const firstGhost = kids.findIndex((e) => e.classList.contains('pk-qs-target'));
    expect(firstGhost).toBeGreaterThan(-1);
    expect(firstGhost).toBeLessThan(disc);
  });

  it('outlines the target nodes derived from targetState alone', () => {
    const { container } = render(
      <QSphereView statevector={zeroState()} targetState={ghz5} classPrefix="pk" />,
    );
    expect(container.querySelectorAll('.pk-qs-dot--target')).toHaveLength(2);
  });
});

describe('QSphereView travelers (#57)', () => {
  // Pole-symmetric mass ⇒ no auto-face ⇒ the default home (yaw 0), whose camera
  // sits on +y: a traveler at y = +1 is on the NEAR hemisphere, y = -1 far.
  const ghz5 = ghzState([0, 1, 2, 3, 4]);
  const near = { x: 0, y: 1, z: 0, radius: 6, hue: 200, opacity: 0.5 };
  const far = { x: 0, y: -1, z: 0, radius: 4, hue: 20, opacity: 1 };

  it('renders one circle per traveler, sized/coloured as given', () => {
    const { container } = render(
      <QSphereView statevector={ghz5} travelers={[near]} classPrefix="pk" />,
    );
    const balls = Array.from(container.querySelectorAll('.pk-qs-traveler')) as SVGCircleElement[];
    expect(balls).toHaveLength(1);
    expect(Number(balls[0].getAttribute('r'))).toBe(6);
    expect(balls[0].getAttribute('fill')).toBe('hsl(200, 70%, 60%)');
    // Near hemisphere: the given opacity, undimmed. Never a pointer target.
    expect(Number(balls[0].getAttribute('fill-opacity'))).toBeCloseTo(0.5, 6);
    expect(balls[0].getAttribute('pointer-events')).toBe('none');
  });

  it('draws far travelers behind the disc and dims them like far nodes', () => {
    const { container } = render(
      <QSphereView statevector={ghz5} travelers={[far, near]} classPrefix="pk" />,
    );
    const kids = Array.from(container.querySelector('.pk-qs-svg')!.children);
    const disc = kids.findIndex((e) => e.classList.contains('pk-qs-disc'));
    const balls = kids.filter((e) => e.classList.contains('pk-qs-traveler'));
    expect(balls).toHaveLength(2);
    expect(kids.indexOf(balls[0])).toBeLessThan(disc); // the far one
    expect(kids.indexOf(balls[1])).toBeGreaterThan(disc); // the near one
    // FAR_OPACITY (0.32) multiplies the traveler's own fade.
    expect(Number(balls[0].getAttribute('fill-opacity'))).toBeCloseTo(0.32, 6);
  });

  it('renders none when the prop is absent (unchanged default view)', () => {
    const { container } = render(<QSphereView statevector={ghz5} classPrefix="bo" />);
    expect(container.querySelectorAll('.bo-qs-traveler')).toHaveLength(0);
  });
});

describe('QSphereView ket labels (#58)', () => {
  const labels = (root: HTMLElement) =>
    Array.from(root.querySelectorAll('.pk-qs-label')).map((e) => e.textContent);

  it('labels only populated nodes, MSB-first like the counts keys', () => {
    // Only |00001⟩ — basis index 1 is qubit 0 set, the RIGHTMOST bit.
    const { container } = render(<QSphereView statevector={basisState(1)} classPrefix="pk" />);
    expect(labels(container)).toEqual(['|00001⟩']);
  });

  it('labels target nodes too, and nothing else', () => {
    const { container } = render(
      <QSphereView
        statevector={basisState(1)}
        targetState={ghzState([0, 1, 2, 3, 4])}
        classPrefix="pk"
      />,
    );
    expect(labels(container).sort()).toEqual(['|00000⟩', '|00001⟩', '|11111⟩']);
  });

  const opacityByText = (root: HTMLElement) =>
    new Map(
      Array.from(root.querySelectorAll('.pk-qs-label')).map((e) => [
        e.textContent,
        Number(e.getAttribute('opacity')),
      ]),
    );

  it('dims a far populated label with its node', () => {
    // Pole-symmetric mass ⇒ no auto-face ⇒ the default home puts |00000⟩ on the
    // far hemisphere and |11111⟩ on the near one.
    const ghz5 = ghzState([0, 1, 2, 3, 4]);
    const { container } = render(
      <QSphereView statevector={ghz5} targetState={ghz5} classPrefix="pk" />,
    );
    const byText = opacityByText(container);
    expect(byText.get('|00000⟩')).toBeLessThan(1);
    expect(byText.get('|11111⟩')).toBe(1);
  });

  it('keeps a far TARGET-ONLY label at full opacity', () => {
    const { container } = render(
      <QSphereView statevector={basisState(31)} targetState={basisState(0)} classPrefix="pk" />,
    );
    // |00000⟩ carries no probability, only the goal — it must stay legible.
    expect(opacityByText(container).get('|00000⟩')).toBe(1);
  });

  it('always opens neutral — a lopsided target must not steer the camera (#75)', () => {
    // Same live state, wildly different targets: every node must project to
    // identical screen positions, i.e. the initial orientation ignores both
    // the target and the populated mass (the #58 auto-face is retired).
    const dots = (c: HTMLElement) =>
      Array.from(c.querySelectorAll('.pk-qs-dot'))
        .map((el) => `${el.getAttribute('cx')},${el.getAttribute('cy')}`)
        .join('|');
    const a = render(
      <QSphereView statevector={basisState(5)} targetState={basisState(9)} classPrefix="pk" />,
    );
    const b = render(<QSphereView statevector={basisState(5)} classPrefix="pk" />);
    expect(dots(a.container)).toBe(dots(b.container));
  });
});
