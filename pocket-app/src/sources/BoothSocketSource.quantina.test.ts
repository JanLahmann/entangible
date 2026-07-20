import { describe, it, expect } from 'vitest';
import { snapshotToUpdate } from './BoothSocketSource';
import type { StateSnapshot } from '@shared/ws/stateSocket';
import type { StateUpdate } from './StateSource';

const fallback = { qubits: 5, gates: [] } as StateUpdate['circuit'];

describe('BoothSocketSource — quantina mapping (QN2)', () => {
  it('maps mode quantina + boothMenu + the latest served broadcast', () => {
    const snap = {
      connectionState: 'open',
      lastSeq: 1,
      layout: {
        type: 'layout',
        mode: 'quantina',
        sidebar: 'right',
        panels: ['menu', 'order', 'results'],
        wires: 'compact',
        noise: 'off',
        menu: 'cocktails',
      },
      served: { type: 'served', seq: 2, packId: 'cocktails', outcomes: ['101'], shotSource: 'noisy' },
    } as unknown as StateSnapshot;

    const u = snapshotToUpdate(snap, fallback);
    expect(u.boothMode).toBe('quantina');
    expect(u.boothMenu).toBe('cocktails');
    expect(u.boothServed?.seq).toBe(2);
    expect(u.boothServed?.outcomes).toEqual(['101']);
    expect(u.boothServed?.shotSource).toBe('noisy');
  });

  it('surfaces a null boothMenu when the pack is unset (no serve yet)', () => {
    const snap = {
      connectionState: 'open',
      lastSeq: null,
      layout: {
        type: 'layout',
        mode: 'quantina',
        sidebar: 'right',
        panels: [],
        wires: 'compact',
        noise: 'off',
        menu: null,
      },
    } as unknown as StateSnapshot;
    const u = snapshotToUpdate(snap, fallback);
    expect(u.boothMenu).toBeNull();
    expect(u.boothServed).toBeUndefined();
  });

  it('leaves boothMenu undefined before any layout arrives', () => {
    const snap = { connectionState: 'connecting', lastSeq: null } as StateSnapshot;
    expect(snapshotToUpdate(snap, fallback).boothMenu).toBeUndefined();
  });
});
