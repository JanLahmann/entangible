// @vitest-environment jsdom
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import type { Circuit } from '@qamposer/react';
import { qasmForCircuit } from '../src/app/qasm';

const here = dirname(fileURLToPath(import.meta.url));
const FIXTURES = resolve(here, '../../tests/fixtures/circuits');

// The pocket app emits QASM locally (no server). These goldens are produced by
// the Python pipeline (qamposer_vision/qasm.py); the local emitter must match
// them byte-for-byte.
const CASES = ['empty', 'single_h', 'bell', 'ghz3', 'all_families', 's_and_t', 'warn_lone_control'];

describe('qasmForCircuit goldens', () => {
  for (const name of CASES) {
    it(`emits ${name}.qasm byte-identically`, () => {
      const circuit = JSON.parse(
        readFileSync(resolve(FIXTURES, `${name}.json`), 'utf8'),
      ) as Circuit;
      const golden = readFileSync(resolve(FIXTURES, `${name}.qasm`), 'utf8');
      expect(qasmForCircuit(circuit)).toBe(golden);
    });
  }
});
