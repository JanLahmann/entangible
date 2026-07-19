/**
 * cameraRoleLink — a tiny external store for the ACTIVE camera-role state
 * (Entangible One, phase U2), mirroring `boothLink`.
 *
 * `active:false` is the normal app (standalone or booth viewer). When active,
 * the phone is serving as the booth's camera: it streams frames to a host and
 * `stateUrl` names that host's `/ws/state` (`null` = the serving origin, the
 * staff-QR case where the pocket app is served BY the host). Both `App` (which
 * owns the `CameraRoleSource` lifecycle) and the settings drawer read/write this
 * store, so entering/leaving the role stays decoupled from the render tree.
 */
import { useSyncExternalStore } from 'react';

export interface CameraRoleState {
  readonly active: boolean;
  /** Host `/ws/state` URL, or `null` to use the serving origin (staff QR). */
  readonly stateUrl: string | null;
}

type Listener = () => void;

let state: CameraRoleState = { active: false, stateUrl: null };
const listeners = new Set<Listener>();

function emit(): void {
  for (const l of listeners) l();
}

export const cameraRoleLink = {
  get: (): CameraRoleState => state,
  /** Enter the camera role. `stateUrl` null → the serving origin (staff QR). */
  enter(stateUrl: string | null = null): void {
    if (state.active && state.stateUrl === stateUrl) return;
    state = { active: true, stateUrl };
    emit();
  },
  /** Leave the camera role, returning to standalone (the local pipeline resumes). */
  exit(): void {
    if (state.active) {
      state = { active: false, stateUrl: null };
      emit();
    }
  },
  subscribe(listener: Listener): () => void {
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  },
};

export function useCameraRole(): CameraRoleState {
  return useSyncExternalStore(cameraRoleLink.subscribe, cameraRoleLink.get, cameraRoleLink.get);
}
