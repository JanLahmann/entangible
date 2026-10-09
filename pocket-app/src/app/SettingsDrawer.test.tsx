// @vitest-environment jsdom
/**
 * Task #48 fix 1: while connected as a booth viewer the booth drives the panel
 * set, so the drawer's PANELS section is read-only (disabled toggles + a
 * "Controlled by booth." note). Disconnected, the toggles are live again.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent } from '@testing-library/react';
import { SettingsControl, resetAdvancedOpen } from './SettingsDrawer';
import { boothLink } from './boothLink';
import { settingsStore } from './settings';
import { courseCode, parseCourseCode } from '@quantum/golfRandom';

function openDrawer() {
  render(<SettingsControl />);
  fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
}

/** Expand the collapsed "Staff & advanced" group. */
function openAdvanced() {
  fireEvent.click(screen.getByRole('button', { name: /Staff & advanced/ }));
}

afterEach(() => {
  boothLink.disconnect();
  settingsStore.update({ mode: 'composer', courseCode: null, boardLayout: 'grid', debug: false });
  resetAdvancedOpen();
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
    openAdvanced();
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
    openAdvanced();
    for (const name of ['More columns', 'Bigger cells']) {
      expect((screen.getByRole('button', { name }) as HTMLButtonElement).disabled).toBe(true);
    }
  });
});

describe('SettingsDrawer visitor / staff split', () => {
  /** Section labels present in the drawer right now, in order. */
  const sectionLabels = () =>
    [...document.querySelectorAll('.pk-drawer .pk-label')].map((el) => el.textContent);

  it('shows the visitor settings directly, the staff group collapsed at the bottom', () => {
    openDrawer();
    // Visitor settings: all there without expanding anything.
    for (const label of ['Mode', 'Input', 'Panels', 'Wires', 'Noise', 'Camera', 'Power']) {
      expect(sectionLabels()).toContain(label);
    }
    expect(screen.getByRole('switch', { name: 'Low-power mode' })).toBeTruthy();
    expect(screen.getByRole('link', { name: /Guide/ })).toBeTruthy();

    // Staff & advanced: collapsed, and its controls genuinely absent.
    const toggle = screen.getByRole('button', { name: /Staff & advanced/ });
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    for (const label of ['Board', 'Sidebar side', 'Booth', 'Developer']) {
      expect(sectionLabels()).not.toContain(label);
    }
    expect(screen.queryByRole('switch', { name: 'Debug panel' })).toBeNull();

    // At the BOTTOM: the group is the drawer body's last section.
    const body = document.querySelector('.pk-drawer-body')!;
    expect(body.lastElementChild?.contains(toggle)).toBe(true);
  });

  it('expanding reaches every staff control, and they still write the same settings', () => {
    openDrawer();
    openAdvanced();
    expect(
      screen.getByRole('button', { name: /Staff & advanced/ }).getAttribute('aria-expanded'),
    ).toBe('true');
    for (const label of ['Board', 'Sidebar side', 'Booth', 'Developer']) {
      expect(sectionLabels()).toContain(label);
    }
    expect(screen.getByLabelText('Booth host')).toBeTruthy();
    fireEvent.click(screen.getByRole('switch', { name: 'Debug panel' }));
    expect(settingsStore.get().debug).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Left' }));
    expect(settingsStore.get().side).toBe('left');
    settingsStore.update({ side: 'right' });
  });

  it('remembers the open group across drawer re-opens, for the page session only', () => {
    openDrawer();
    openAdvanced();
    // Close the drawer and open it again: still expanded.
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(
      screen.getByRole('button', { name: /Staff & advanced/ }).getAttribute('aria-expanded'),
    ).toBe('true');
    // Nothing persisted: the open state is not a setting.
    expect(JSON.stringify(settingsStore.get())).not.toMatch(/advanced/i);
    expect(JSON.stringify({ ...localStorage })).not.toMatch(/advanced/i);
  });
});
