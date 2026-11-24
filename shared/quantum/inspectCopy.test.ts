import { describe, it, expect } from 'vitest';
import type { Gate } from '@qamposer/react';
import {
  gateInspectCopy,
  outcomeInspectCopy,
  formatAngle,
  POPOVER_MS,
} from './inspectCopy';

let seq = 0;
const g = (partial: Omit<Gate, 'id'>): Gate => ({ id: `g${seq++}`, ...partial });

describe('formatAngle', () => {
  it('renders radians as a fraction of π', () => {
    expect(formatAngle(Math.PI / 2)).toBe('0.50π');
    expect(formatAngle(Math.PI)).toBe('1.00π');
    expect(formatAngle(undefined)).toBe('0.00π');
  });
});

describe('gateInspectCopy', () => {
  it('names the qubit and a one-sentence effect for each single-qubit type', () => {
    expect(gateInspectCopy(g({ type: 'H', qubit: 0, position: 0 }))).toMatch(/^H puts q0/);
    expect(gateInspectCopy(g({ type: 'X', qubit: 2, position: 0 }))).toMatch(/q2/);
    expect(gateInspectCopy(g({ type: 'Y', qubit: 1, position: 0 }))).toMatch(/q1/);
    expect(gateInspectCopy(g({ type: 'Z', qubit: 4, position: 0 }))).toMatch(/q4/);
  });

  it('describes a CNOT in terms of both qubits', () => {
    const copy = gateInspectCopy(g({ type: 'CNOT', control: 1, target: 2, position: 0 }));
    expect(copy).toMatch(/CNOT/);
    expect(copy).toMatch(/q2/); // target flipped
    expect(copy).toMatch(/q1/); // control
  });

  it('includes the angle for rotation gates', () => {
    expect(gateInspectCopy(g({ type: 'RX', qubit: 0, parameter: Math.PI, position: 0 }))).toMatch(
      /RX.*1\.00π/,
    );
    expect(gateInspectCopy(g({ type: 'RY', qubit: 0, parameter: Math.PI / 2, position: 0 }))).toMatch(
      /RY.*0\.50π/,
    );
  });

  it('names S and T when they arrive as fixed-angle RZ gates', () => {
    expect(gateInspectCopy(g({ type: 'RZ', qubit: 0, parameter: Math.PI / 2, position: 0 }))).toMatch(
      /^S adds/,
    );
    expect(gateInspectCopy(g({ type: 'RZ', qubit: 3, parameter: Math.PI / 4, position: 0 }))).toMatch(
      /^T adds/,
    );
    // A plain RZ (other angle) stays an RZ.
    expect(gateInspectCopy(g({ type: 'RZ', qubit: 0, parameter: Math.PI, position: 0 }))).toMatch(
      /^RZ rotates/,
    );
  });
});

describe('outcomeInspectCopy', () => {
  it('maps each bit to its qubit and states the probability', () => {
    expect(outcomeInspectCopy('110', 0.5)).toBe(
      '110: q2=1, q1=1, q0=0 — seen in 50% of runs.',
    );
  });

  it('never reads 0% for a tiny non-zero outcome', () => {
    expect(outcomeInspectCopy('01', 0.003)).toMatch(/<1% of runs/);
  });

  it('reads 100% for a certain outcome', () => {
    expect(outcomeInspectCopy('00', 1)).toMatch(/100% of runs/);
  });
});

describe('constants', () => {
  it('auto-dismiss window is 6s per spec', () => {
    expect(POPOVER_MS).toBe(6000);
  });
});
