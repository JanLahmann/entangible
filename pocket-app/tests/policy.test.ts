/**
 * Viewer-policy guard (Entangible One — docs/design.md).
 *
 * The Display role's default policy is READ-ONLY: viewer/kiosk surfaces receive
 * circuit/detection/layout but NEVER send a `select_*` (or `serve`) control
 * message. The three sanctioned senders (docs/quantina.md decision 6) are:
 *  - the staff CAMERA role — `select_camera {kind:'push'}` from `CameraRoleSource`;
 *  - the operator `/debug` cards — `select_mode`/`select_layout`/`select_noise`/
 *    `select_menu`/`serve` from `DebugView` (the only operator SPA surface);
 *  - the PROVISIONED kiosk's touch Serve — `serve` from `kiosk/serve.ts`, whose
 *    `sendServe` is guarded on operator standing (a keyless kiosk is a no-op).
 *
 * This test statically scans the pocket source tree for control SEND sites
 * (a `type: 'select_…'` or `type: 'serve'` object literal) and asserts they
 * live ONLY in those modules. If a future change adds a control send anywhere
 * else — most dangerously the kiosk viewer — this fails loudly. It complements
 * the behavioral BoothSocketSource viewer-policy test.
 */
import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const srcDir = join(here, '..', 'src');

/** The ONLY modules allowed to send a `select_*` / `serve` control message. */
const ALLOWED = new Set([
  'sources/CameraRoleSource.ts', // staff CAMERA role → select_camera {kind:'push'}
  'debug/DebugView.tsx', // operator /debug cards → select_* + serve
  'kiosk/serve.ts', // provisioned kiosk touch Serve → serve (operator-gated)
]);

// Matches a control-message SEND (an object literal `type: 'select_…'` or
// `type: 'serve'`), not a comment or a type/name mention.
const SEND_RE = /type:\s*['"](?:select_|serve['"])/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

describe('viewer policy: control sends stay out of viewer surfaces', () => {
  it('only the camera-role, /debug and kiosk-serve modules send controls', () => {
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
