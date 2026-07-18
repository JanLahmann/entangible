/**
 * React binding for the shared `/ws/state` socket.
 *
 * Uses `useSyncExternalStore` over a module singleton so every view
 * (booth, debug) reads the same snapshot and the socket is opened once.
 */
import { useSyncExternalStore } from 'react';
import {
  getStateSocket,
  type StateSnapshot,
  type StateSocket,
} from './stateSocket';

const SERVER_SNAPSHOT: StateSnapshot = {
  connectionState: 'connecting',
  lastSeq: null,
};

/**
 * Subscribe a component to the live Entangible state. Starts the socket on the
 * first subscription and returns the latest immutable snapshot.
 */
export function useEntangibleState(): StateSnapshot {
  const socket: StateSocket = getStateSocket();
  return useSyncExternalStore(
    (onChange) => {
      // Ensure the socket is running while anyone is listening.
      socket.start();
      return socket.subscribe(onChange);
    },
    () => socket.getSnapshot(),
    () => SERVER_SNAPSHOT,
  );
}
