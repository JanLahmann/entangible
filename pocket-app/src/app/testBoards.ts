/**
 * Test-board catalogue for the Guide's "Test without a printer" section.
 *
 * The eight boards live in the repo's `examples/test-boards/` (one source of
 * truth, shared with the booth and the CLI). They are imported with Vite's
 * `?url` suffix so each PNG is processed and content-hashed into `dist/` at
 * build — the deploy stays self-contained; nothing is fetched at runtime.
 * (vite.config.ts adds `../examples` to `server.fs.allow` for dev.)
 *
 * Titles + one-liners are ported from examples/test-boards/README.md.
 */
import empty from '../../../examples/test-boards/01-empty.png?url';
import singleH from '../../../examples/test-boards/02-single-h.png?url';
import bell from '../../../examples/test-boards/03-bell.png?url';
import ghz3 from '../../../examples/test-boards/04-ghz3.png?url';
import ghz5 from '../../../examples/test-boards/05-ghz5.png?url';
import allFamilies from '../../../examples/test-boards/06-all-families.png?url';
import uniform32 from '../../../examples/test-boards/07-uniform-32.png?url';
import loneControl from '../../../examples/test-boards/08-lone-control.png?url';
import dials from '../../../examples/test-boards/09-dials.png?url';

export interface TestBoard {
  /** Stable id (the source filename stem). */
  readonly id: string;
  /** Bundled, content-hashed asset URL. */
  readonly src: string;
  /** Short title shown on the thumbnail and in the fullscreen indicator. */
  readonly title: string;
  /** One-line scenario description (ported from the README). */
  readonly blurb: string;
}

export const TEST_BOARDS: readonly TestBoard[] = [
  {
    id: '01-empty',
    src: empty,
    title: 'Empty board',
    blurb: 'Corners only — expect an empty circuit.',
  },
  {
    id: '02-single-h',
    src: singleH,
    title: 'H on q0',
    blurb: 'A single Hadamard — one qubit in superposition.',
  },
  {
    id: '03-bell',
    src: bell,
    title: 'Bell pair',
    blurb: 'H then CNOT — expect the entanglement celebration.',
  },
  {
    id: '04-ghz3',
    src: ghz3,
    title: 'GHZ-3',
    blurb: 'A CNOT chain — repeated ●/⊕ ids exercise spatial dedupe.',
  },
  {
    id: '05-ghz5',
    src: ghz5,
    title: 'GHZ-5',
    blurb: 'Full-height CNOT staircase — golf hole 5.',
  },
  {
    id: '06-all-families',
    src: allFamilies,
    title: 'Every gate family',
    blurb: 'One of each, including S/T and rotations.',
  },
  {
    id: '07-uniform-32',
    src: uniform32,
    title: 'H on all five qubits',
    blurb: '32 equally likely outcomes — a histogram stress test.',
  },
  {
    id: '08-lone-control',
    src: loneControl,
    title: 'Lone control',
    blurb: 'A ● with no ⊕ partner — a friendly warning, no CNOT.',
  },
  {
    id: '09-dials',
    src: dials,
    title: 'Dial tiles',
    blurb: 'RX/RY/RZ dials — the tile’s rotation selects the angle.',
  },
];
