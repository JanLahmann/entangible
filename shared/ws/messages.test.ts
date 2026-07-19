// @vitest-environment node
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  ALL_MESSAGE_TYPES,
  SERVER_MESSAGE_TYPES,
  CLIENT_MESSAGE_TYPES,
  type CircuitMessage,
  type DetectionMessage,
  type StatusMessage,
  type LayoutMessage,
  type HelloAck,
  type ClientHello,
  type SelectCamera,
  type SelectMode,
  type SelectLayout,
} from './messages';

// This suite runs under the pocket app (SC1 rule: shared tests run once there);
// cwd = pocket-app, and the docs live one level up at the repo root.
const PROTOCOL_PATH = resolve(process.cwd(), '..', 'docs', 'protocol.md');
const PROTOCOL = readFileSync(PROTOCOL_PATH, 'utf8');

/** Strip JSONC (// and block comments) and trailing commas. */
function stripJsonc(block: string): string {
  const noBlock = block.replace(/\/\*[\s\S]*?\*\//g, '');
  const noLine = noBlock.replace(/^\s*\/\/.*$/gm, '').replace(/\/\/.*$/gm, '');
  return noLine.replace(/,(\s*[}\]])/g, '$1');
}

/**
 * Split a comment-stripped string into its top-level `{...}` object substrings.
 * A single fenced block may document more than one message (e.g. `select_mode`
 * + `select_layout` share one block), so parse each object independently.
 */
function splitTopLevelObjects(text: string): string[] {
  const objects: string[] = [];
  let depth = 0;
  let start = -1;
  let inStr = false;
  let esc = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === '{') {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === '}') {
      depth--;
      if (depth === 0 && start >= 0) {
        objects.push(text.slice(start, i + 1));
        start = -1;
      }
    }
  }
  return objects;
}

/** Extract every JSON object from every ```jsonc fenced block in the doc. */
function extractJsoncBlocks(md: string): unknown[] {
  const re = /```jsonc\n([\s\S]*?)```/g;
  const blocks: unknown[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(md)) !== null) {
    for (const obj of splitTopLevelObjects(stripJsonc(m[1]))) {
      blocks.push(JSON.parse(obj));
    }
  }
  return blocks;
}

const DOC_BLOCKS = extractJsoncBlocks(PROTOCOL);

// --- Reference TS samples (compile-time checked via `satisfies`) ------------
// Each includes every documented key, including optionals, so the documented
// examples' keys must be a subset of these.

const circuitSample = {
  type: 'circuit',
  seq: 0,
  circuit: { qubits: 0, gates: [] },
  qasm: '',
  source: 'camera',
} satisfies CircuitMessage;

const detectionSample = {
  type: 'detection',
  fps: 0,
  board: { found: false, corners: 0, reprojectionErrorMm: null },
  markers: [{ id: 0, row: 0, col: 0, offGrid: true }],
  warnings: [{ code: '', message: '', row: 0, col: 0 }],
} satisfies DetectionMessage;

const statusSample = {
  type: 'status',
  camera: { kind: 'replay', name: '', connected: false },
  backend: { enabled: false, healthy: false },
  clients: 0,
} satisfies StatusMessage;

const helloAckSample = {
  type: 'hello_ack',
  role: 'viewer',
} satisfies HelloAck;

const helloSample = {
  type: 'hello',
  role: 'display',
  client: '',
  key: '',
} satisfies ClientHello;

const selectCameraSample = {
  type: 'select_camera',
  kind: 'cv2',
  index: 0,
} satisfies SelectCamera;

const layoutSample = {
  type: 'layout',
  mode: 'composer',
  sidebar: 'right',
  panels: ['results'],
  wires: 'compact',
} satisfies LayoutMessage;

const selectModeSample = {
  type: 'select_mode',
  mode: 'golf',
} satisfies SelectMode;

const selectLayoutSample = {
  type: 'select_layout',
  sidebar: 'left',
  panels: ['results'],
  wires: 'all',
} satisfies SelectLayout;

const SAMPLES: Record<string, unknown> = {
  circuit: circuitSample,
  detection: detectionSample,
  status: statusSample,
  layout: layoutSample,
  hello_ack: helloAckSample,
  hello: helloSample,
  select_camera: selectCameraSample,
  select_mode: selectModeSample,
  select_layout: selectLayoutSample,
};

/**
 * Assert every key present in `doc` also exists in `sample` (recursively).
 * Arrays are compared element-by-element against `sample`'s representative
 * element (index 0), which carries the union of optional keys.
 */
function assertKeysSubset(doc: unknown, sample: unknown, path: string): void {
  if (Array.isArray(doc)) {
    expect(Array.isArray(sample), `${path} should be an array in the sample`).toBe(
      true,
    );
    const rep = (sample as unknown[])[0];
    for (let i = 0; i < doc.length; i++) {
      assertKeysSubset(doc[i], rep, `${path}[${i}]`);
    }
    return;
  }
  if (doc && typeof doc === 'object') {
    expect(sample && typeof sample === 'object', `${path} should be an object`).toBe(
      true,
    );
    for (const key of Object.keys(doc as Record<string, unknown>)) {
      expect(
        Object.prototype.hasOwnProperty.call(sample, key),
        `docs/protocol.md key "${path}.${key}" is missing from the TS type sample`,
      ).toBe(true);
      assertKeysSubset(
        (doc as Record<string, unknown>)[key],
        (sample as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
    }
  }
  // primitives: nothing to check
}

describe('protocol.md ⇄ messages.ts parity', () => {
  it('finds the documented jsonc blocks', () => {
    // Documented objects: circuit, detection, status, hello, select_camera,
    // layout, select_mode, select_layout (the last two share one fenced block).
    // (The /ws/frames capture hello is inline code, not a fenced block.)
    expect(DOC_BLOCKS.length).toBeGreaterThanOrEqual(8);
  });

  it('every documented block `type` is a known message type', () => {
    for (const block of DOC_BLOCKS) {
      const t = (block as { type?: unknown }).type;
      expect(typeof t).toBe('string');
      expect(ALL_MESSAGE_TYPES as readonly string[]).toContain(t as string);
    }
  });

  it('every exported message type appears in the doc', () => {
    const docTypes = new Set(
      DOC_BLOCKS.map((b) => (b as { type: string }).type),
    );
    for (const t of ALL_MESSAGE_TYPES) {
      expect(docTypes.has(t), `type "${t}" is not documented`).toBe(true);
    }
  });

  it('server + client type lists partition the union with no overlap', () => {
    const overlap = SERVER_MESSAGE_TYPES.filter((t) =>
      (CLIENT_MESSAGE_TYPES as readonly string[]).includes(t),
    );
    expect(overlap).toEqual([]);
    expect(ALL_MESSAGE_TYPES.length).toBe(
      SERVER_MESSAGE_TYPES.length + CLIENT_MESSAGE_TYPES.length,
    );
  });

  it('documented example keys are all present in the TS type samples', () => {
    for (const block of DOC_BLOCKS) {
      const t = (block as { type: string }).type;
      const sample = SAMPLES[t];
      expect(sample, `no TS sample for documented type "${t}"`).toBeDefined();
      assertKeysSubset(block, sample, t);
    }
  });
});
