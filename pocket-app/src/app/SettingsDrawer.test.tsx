// @vitest-environment jsdom
/**
 * Task #48 fix 1: while connected as a booth viewer the booth drives the panel
 * set, so the drawer's PANELS section is read-only (disabled toggles + a
 * "Controlled by booth." note). Disconnected, the toggles are live again.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { SettingsControl } from './SettingsDrawer';
import { boothLink } from './boothLink';
import { settingsStore } from './settings';
import { courseCode, parseCourseCode } from '@quantum/golfRandom';

function openDrawer() {
  render(<SettingsControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
}

afterEach(() => {
  boothLink.disconnect();
  settingsStore.update({ mode: 'composer', courseCode: null, boardLayout: 'grid' });
  cleanup();
});

describe('SettingsDrawer PANELS section', () => {
  it('is live (enabled, no booth note) when standalone', () => {
    openDrawer();
    expect((screen.getByRole('switch', { name: 'Results' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
    expect(screen.queryByText('Controlled by booth.')).toBeNull();
  });

  it('is disabled with a "Controlled by booth." note while connected', () => {
    boothLink.connect('wss://booth.local:8443');
    openDrawer();
    for (const name of ['Camera preview', 'Results', 'State', 'OpenQASM']) {
      expect((screen.getByRole('switch', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByText('Controlled by booth.')).toBeTruthy();
  });
});

describe('SettingsDrawer golf course code (#78)', () => {
  it('applies a typed code, and clearing the field returns to the classic course', () => {
    settingsStore.update({ mode: 'golf' });
    openDrawer();
    const input = screen.getByLabelText('Golf course code') as HTMLInputElement;
    expect(input.value).toBe('');

    fireEvent.change(input, { target: { value: ' 1Z9K4H ' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    // Stored in the canonical spelling, so the card and a copied link agree.
    expect(settingsStore.get().courseCode).toBe('1z9k4h');
    expect(parseCourseCode('1z9k4h')).toBe(Number.parseInt('1z9k4h', 36));

    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(settingsStore.get().courseCode).toBeNull();
  });

  it('refuses a code that is not one, rather than dealing a different course', () => {
    settingsStore.update({ mode: 'golf', courseCode: courseCode(4242) });
    openDrawer();
    const input = screen.getByLabelText('Golf course code') as HTMLInputElement;
    expect(input.value).toBe(courseCode(4242));

    fireEvent.change(input, { target: { value: 'not a code' } });
    expect(input.className).toContain('is-invalid');
    fireEvent.blur(input);
    expect(settingsStore.get().courseCode).toBe(courseCode(4242)); // unchanged
  });

  it('is a golf-mode control — absent in the other modes', () => {
    settingsStore.update({ mode: 'composer' });
    openDrawer();
    expect(screen.queryByLabelText('Golf course code')).toBeNull();
  });
});

describe('SettingsDrawer BOARD section (#94)', () => {
  it('defaults to more columns and switches to bigger cells', () => {
    openDrawer();
    const more = screen.getByRole('button', { name: 'More columns' });
    const bigger = screen.getByRole('button', { name: 'Bigger cells' });
    expect(more.getAttribute('aria-pressed')).toBe('true');
    expect(bigger.getAttribute('aria-pressed')).toBe('false');

    fireEvent.click(bigger);
    expect(settingsStore.get().boardLayout).toBe('stretch');
  });

  it('is locked while connected — the booth owns the board layout', () => {
    boothLink.connect('wss://booth.local:8443');
    openDrawer();
    for (const name of ['More columns', 'Bigger cells']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});
