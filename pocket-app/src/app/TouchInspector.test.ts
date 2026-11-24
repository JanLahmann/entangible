import { describe, it, expect } from 'vitest';
import type { Circuit, Gate } from '@qamposer/react';
import { gateInspectAt, outcomeInspectFromAttrs } from './TouchInspector';

let seq = 0;
const g = (partial: Omit<Gate, 'id'>): Gate => ({ id: `g${seq++}`, ...partial });

const circuit = (gates: Gate[]): Circuit => ({ qubits: 5, gates });

describe('gateInspectAt', () => {
  it('maps a DOM sibling index to circuit.gates[index] copy', () => {
    const c = circuit([
      g({ type: 'H', qubit: 0, position: 0 }),
      g({ type: 'CNOT', control: 0, target: 1, position: 1 }),
    ]);
    expect(gateInspectAt(c, 0)).toMatch(/^H puts q0/);
    expect(gateInspectAt(c, 1)).toMatch(/CNOT/);
  });

  it('returns null for an out-of-range or negative index', () => {
    const c = circuit([g({ type: 'X', qubit: 2, position: 0 })]);
    expect(gateInspectAt(c, -1)).toBeNull();
    expect(gateInspectAt(c, 5)).toBeNull();
  });
});

describe('outcomeInspectFromAttrs', () => {
  it('builds outcome copy from data-bits / data-prob strings', () => {
    expect(outcomeInspectFromAttrs('110', '0.5')).toBe(
      '110: q2=1, q1=1, q0=0 — seen in 50% of runs.',
    );
  });

  it('returns null when either attribute is missing', () => {
    expect(outcomeInspectFromAttrs(null, '0.5')).toBeNull();
    expect(outcomeInspectFromAttrs('110', null)).toBeNull();
  });

  it('returns null when data-prob is not a finite number', () => {
    expect(outcomeInspectFromAttrs('11', 'not-a-number')).toBeNull();
  });
});
