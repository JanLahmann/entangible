/**
 * Viewer-policy guard (Entangible One — docs/design.md).
 *
 * The Display role's default policy is READ-ONLY: viewer/kiosk surfaces receive
 * circuit/detection/layout but NEVER send a `select_*` control message. The two
 * sanctioned exceptions are the staff CAMERA role (`select_camera {kind:'push'}`
 * from `CameraRoleSource`) and the operator `/debug` Layout card
 * (`select_mode` / `select_layout` from `DebugView`).
 *
 * This test statically scans the pocket source tree for `select_*` SEND sites
 * (a `type: 'select_…'` object literal) and asserts they live ONLY in those two
 * modules. If a future change adds a `select_*` send anywhere else — most
 * dangerously the kiosk viewer — this fails loudly. It complements the
 * behavioral BoothSocketSource viewer-policy test.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

/** The ONLY modules allowed to send a `select_*` control message. */
const ALLOWED = new Set([
  'sources/CameraRoleSource.ts', // staff CAMERA role → select_camera {kind:'push'}
  'debug/DebugView.tsx', // operator /debug Layout card → select_mode / select_layout
]);

// Matches a `select_*` message SEND (an object literal `type: 'select_…'`),
// not a comment or a type/name mention.
const SEND_RE = /type:\s*['"]select_/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('viewer policy: select_* stays out of viewer surfaces', () => {
  it('only the camera-role and /debug modules send select_* controls', () => {
    const offenders: string[] = [];
    const senders: string[] = [];
    for (const file of walk(srcDir)) {
      const rel = relative(srcDir, file).split('\\').join('/');
      const text = readFileSync(file, 'utf8');
      if (SEND_RE.test(text)) {
        senders.push(rel);
        if (!ALLOWED.has(rel)) offenders.push(rel);
      }
    }
    // No unexpected sender…
    expect(offenders).toEqual([]);
    // …and both sanctioned senders are present (guards against silent removal
    // that would make the allow-list stale).
    expect(new Set(senders)).toEqual(ALLOWED);
  });
});
