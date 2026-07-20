// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import type { Circuit } from '@qamposer/react';
import { QuantinaPanel } from './QuantinaPanel';
import { builtinPack } from '@shared/menu/builtinPacks';

const coffee = builtinPack('coffee')!;
const bell: Circuit = {
  qubits: 5,
  gates: [{ id: 'H-0', type: 'H', position: 0, qubit: 0 }],
} as Circuit;

afterEach(cleanup);

describe('QuantinaPanel viewer sync (QN2)', () => {
  it('hides the Serve controls and reveals the external (booth) result', () => {
    const { container } = render(
      <QuantinaPanel
        pack={coffee}
        circuit={bell}
        externalResult={{ packId: 'coffee', outcomes: ['010'], shotSource: 'real' }}
        externalSeq={5}
        canServe={false}
      />,
    );
    // Read-only viewer: no Serve button.
    expect(container.querySelector('.pk-quantina-serve-btn')).toBeNull();
    // External result revealed, keyed on its seq.
    const reveal = container.querySelector('.pk-reveal');
    expect(reveal?.getAttribute('data-seq')).toBe('5');
    // 010 → Espresso, tagged as a real-hardware serve.
    expect(screen.getAllByText('Espresso').length).toBeGreaterThan(0);
    expect(screen.getByText(/measured on real hardware/)).toBeTruthy();
  });

  it('shows the Serve button by default (standalone, canServe defaults true)', () => {
    const { container } = render(<QuantinaPanel pack={coffee} circuit={bell} />);
    expect(container.querySelector('.pk-quantina-serve-btn')).not.toBeNull();
  });
});
