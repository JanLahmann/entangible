/**
 * Warning totality: every warning kind EITHER vision pipeline can emit (TS
 * pocket + Python host) has visitor-grade copy in `friendlyWarning` and an
 * explicit kiosk decision in `WARNING_AUDIENCE`. The kinds are pinned twice —
 * the TS `WARNING_KINDS` list and a grep of both pipelines' sources — so a new
 * kind fails here until it is listed AND classified. Twin of
 * `packages/qamposer-vision/tests/test_warning_kinds.py`.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync, readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { WARNING_KINDS, type WarningKind } from '../src/vision/circuitBuilder';
import {
  WARNING_AUDIENCE,
  friendlyWarning,
  kioskVisible,
  type WarningAudience,
} from '@shared/display/warnings';

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(here, '../..');

// Compile-time half of the totality check: a TS kind with no audience entry is
// a type error (`tsc --noEmit` is a gate).
const AUDIENCE_BY_KIND: Record<WarningKind, WarningAudience> = WARNING_AUDIENCE;

function sources(dir: string, ext: string): string[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith(ext))
    .map((f) => readFileSync(resolve(dir, f), 'utf8'));
}

/** Every `BuildWarning(kind="…")` constructed anywhere in the Python package. */
function pythonKinds(): Set<string> {
  const dir = resolve(REPO_ROOT, 'packages/qamposer-vision/src/qamposer_vision');
  const kinds = new Set<string>();
  for (const src of sources(dir, '.py')) {
    for (const m of src.matchAll(/BuildWarning\(\s*kind="([a-z_]+)"/g)) kinds.add(m[1]);
  }
  return kinds;
}

/** Every `kind: '…'` that opens a warning object literal in the TS pipeline. */
function tsKinds(): Set<string> {
  const dir = resolve(here, '../src/vision');
  const kinds = new Set<string>();
  for (const src of sources(dir, '.ts')) {
    for (const m of src.matchAll(/kind: '([a-z_]+)'(?: as const)?,\s*\n\s*message:/g)) {
      kinds.add(m[1]);
    }
  }
  return kinds;
}

const sorted = (xs: Iterable<string>) => [...xs].sort();

describe('warning kinds — totality across both pipelines', () => {
  it('the grep finds the kinds (guards the regexes themselves)', () => {
    expect(pythonKinds().size).toBeGreaterThanOrEqual(10);
    expect(tsKinds().size).toBeGreaterThanOrEqual(10);
  });

  it('WARNING_KINDS is exactly what the TS pipeline and the Python package emit', () => {
    expect(sorted(tsKinds())).toEqual(sorted(WARNING_KINDS));
    expect(sorted(pythonKinds())).toEqual(sorted(WARNING_KINDS));
  });

  it('every kind has an explicit kiosk decision, and nothing else does', () => {
    expect(sorted(Object.keys(WARNING_AUDIENCE))).toEqual(sorted(WARNING_KINDS));
    for (const kind of WARNING_KINDS) {
      expect(['visitor', 'staff']).toContain(AUDIENCE_BY_KIND[kind]);
    }
  });

  it.each([...WARNING_KINDS])('%s gets friendly copy, never the raw message', (kind) => {
    const raw = `RAW developer text for ${kind}`;
    for (const col of [undefined, 2]) {
      const copy = friendlyWarning({ code: kind, col, message: raw });
      expect(copy).not.toBe(raw);
      expect(copy).not.toMatch(/^Check the board/); // the unknown-code fallback
      expect(copy).not.toMatch(/\bmm\b|marker \d|\(\d+, \d+\)/); // no dev detail
    }
  });

  it('pins the kiosk split: inventory and set-up are staff-only', () => {
    const visible = WARNING_KINDS.filter((kind) => kioskVisible({ code: kind }));
    expect(sorted(visible)).toEqual(
      sorted([
        'cell_conflict',
        'lone_control',
        'lone_target',
        'lone_swap',
        'control_ambiguous',
        'off_grid',
        'unpaired_measure',
      ]),
    );
    expect(kioskVisible({ code: 'stray_tiles' })).toBe(false);
    expect(kioskVisible({ code: 'stray_furniture' })).toBe(false);
    expect(kioskVisible({ code: 'measure_span_mismatch' })).toBe(false);
    // An unknown code from a newer host stays off the visitor screens.
    expect(kioskVisible({ code: 'some_future_kind' })).toBe(false);
  });
});
