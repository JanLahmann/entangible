// @vitest-environment jsdom
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen } from '@testing-library/react';
import { AttractMode } from './AttractMode';

afterEach(cleanup);

describe('AttractMode co-brand', () => {
  it('stays plain (no co-brand) when branding is absent', () => {
    const { container } = render(<AttractMode />);
    expect(container.querySelector('.ent-attract__cobrand')).toBeNull();
    // Accessible label is the un-branded call to action.
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Entangible — place a tile on the table to begin',
    );
  });

  it('shows "Entangible at ⟨event⟩" when an event name is configured', () => {
    render(<AttractMode branding={{ name: 'Quantum Fair 2026' }} />);
    expect(screen.getByText('Quantum Fair 2026')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('aria-label')).toBe(
      'Entangible at Quantum Fair 2026 — place a tile on the table to begin',
    );
  });

  it('prefers the event logo over the name when provided', () => {
    const { container } = render(
      <AttractMode branding={{ name: 'Quantum Fair', logoUrl: '/api/branding/logo' }} />,
    );
    const img = container.querySelector('.ent-attract__cobrand img') as HTMLImageElement | null;
    expect(img).not.toBeNull();
    expect(img?.getAttribute('src')).toBe('/api/branding/logo');
  });

  it('ignores a blank event name (stays plain)', () => {
    const { container } = render(<AttractMode branding={{ name: '   ' }} />);
    expect(container.querySelector('.ent-attract__cobrand')).toBeNull();
  });
});
