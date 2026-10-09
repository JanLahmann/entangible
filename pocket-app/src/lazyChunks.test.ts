/**
 * Code-splitting guard: the parts a cold visitor on the welcome card never sees
 * must stay OUT of the entry chunk. One static `import … from './GuidePage'` in
 * App.tsx would silently pull the Guide (and its images/PDF) back into the
 * first download — the build still passes, only phones on a weak WLAN notice.
 *
 * For each entry-chunk file this reads the source and checks that every listed
 * module is reached ONLY through a dynamic `import()` (type-only imports are
 * fine: they vanish at build time).
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, it, expect } from 'vitest';

/** Entry-chunk source file → the modules it may only load lazily. */
const LAZY: Record<string, readonly string[]> = {
  'main.tsx': ['./kiosk/KioskView', './debug/DebugView'],
  'app/App.tsx': ['./GuidePage', './RunnerGame', './QuantinaPanel', './DebugPanel', '../vision/matDetect'],
  'app/useCamera.ts': ['../vision/pipeline'],
  'app/composerQrCode.ts': ['qrcode'],
};

function source(file: string): string {
  return readFileSync(fileURLToPath(new URL(`./${file}`, import.meta.url)), 'utf8');
}

/** Static value imports of `spec` (`import type …` excluded). */
function staticImports(src: string, spec: string): string[] {
  const quoted = spec.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
  const re = new RegExp(`^\\s*import\\s+(?!type\\s)[^;]*?from\\s+['"]${quoted}['"]`, 'gm');
  return src.match(re) ?? [];
}

describe('code splitting — lazy modules stay out of the entry chunk', () => {
  for (const [file, specs] of Object.entries(LAZY)) {
    for (const spec of specs) {
      it(`${file} loads ${spec} only via import()`, () => {
        const src = source(file);
        expect(staticImports(src, spec)).toEqual([]);
        expect(src).toContain(`import('${spec}')`);
      });
    }
  }

  it('catches a static import (self-check of the matcher)', () => {
    const sample = "import { GuidePage } from './GuidePage';\nimport type { X } from './RunnerGame';";
    expect(staticImports(sample, './GuidePage')).toHaveLength(1);
    expect(staticImports(sample, './RunnerGame')).toEqual([]);
  });
});
