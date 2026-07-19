import { describe, it, expect } from 'vitest';
import {
  LocalPipelineSource,
  buildWarningToInput,
} from '../../src/sources/LocalPipelineSource';
import type { FrameResult } from '../../src/vision/pipeline';
import type { StateUpdate } from '../../src/sources/StateSource';

/** Minimal FrameResult stub — only the fields LocalPipelineSource reads. */
function frame(partial: Partial<FrameResult>): FrameResult {
  return {
    changed: false,
    circuit: { qubits: 5, gates: [] },
    warnings: [],
    ...partial,
  } as FrameResult;
}

describe('buildWarningToInput', () => {
  it('maps kind → code and preserves col/message', () => {
    expect(buildWarningToInput({ kind: 'off_grid', message: 'slide it', col: 4 } as never)).toEqual({
      code: 'off_grid',
      col: 4,
      message: 'slide it',
    });
    expect(
      buildWarningToInput({ kind: 'lone_control', message: 'x', col: null } as never).col,
    ).toBeUndefined();
  });
});

describe('LocalPipelineSource', () => {
  it('emits a neutral local update only on changed frames', () => {
    const source = new LocalPipelineSource();
    const updates: StateUpdate[] = [];
    source.subscribe((u) => updates.push(u));
    source.start();

    source.ingest(frame({ changed: false }));
    expect(updates).toHaveLength(0); // unchanged → no emit

    const circuit = { qubits: 5, gates: [{ id: 'h-0-0' }] };
    source.ingest(
      frame({
        changed: true,
        circuit: circuit as never,
        warnings: [{ kind: 'lone_target', message: 'm', col: 1 } as never],
      }),
    );
    expect(updates).toHaveLength(1);
    expect(updates[0].source).toBe('local');
    expect(updates[0].circuit).toBe(circuit);
    expect(updates[0].warnings).toEqual([{ code: 'lone_target', col: 1, message: 'm' }]);
    // Local updates never carry booth-only fields.
    expect(updates[0].boothMode).toBeUndefined();
    expect(updates[0].connection).toBeUndefined();

    source.stop();
  });

  it('stops delivering after unsubscribe', () => {
    const source = new LocalPipelineSource();
    const updates: StateUpdate[] = [];
    const unsub = source.subscribe((u) => updates.push(u));
    unsub();
    source.ingest(frame({ changed: true }));
    expect(updates).toHaveLength(0);
  });
});
