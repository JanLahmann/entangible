import { describe, it, expect, vi } from 'vitest';
import { sendServe } from './serve';
import type { StateSocket } from '@shared/ws/stateSocket';

/** A minimal fake StateSocket exposing just the bits `sendServe` touches. */
function fakeSocket(operator: boolean | undefined) {
  const send = vi.fn(() => true);
  const socket = {
    getSnapshot: () => ({ operator, connectionState: 'open', lastSeq: null }),
    send,
  } as unknown as StateSocket;
  return { socket, send };
}

describe('kiosk sendServe — operator gate (decision 6)', () => {
  it('no-ops (never touches the wire) for a viewer socket', () => {
    const { socket, send } = fakeSocket(false);
    expect(sendServe(socket, ['010'], 'ideal')).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('no-ops before any hello_ack (operator undefined)', () => {
    const { socket, send } = fakeSocket(undefined);
    expect(sendServe(socket, ['010'], 'ideal')).toBe(false);
    expect(send).not.toHaveBeenCalled();
  });

  it('sends a serve for an operator socket', () => {
    const { socket, send } = fakeSocket(true);
    expect(sendServe(socket, ['010'], 'noisy')).toBe(true);
    expect(send).toHaveBeenCalledWith({ type: 'serve', outcomes: ['010'], shotSource: 'noisy' });
  });
});
