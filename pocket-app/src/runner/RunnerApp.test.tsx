// @vitest-environment jsdom
/**
 * Smoke render of the runner-only bundle's shell (docs/runner-bundle.md): it
 * mounts the game with no site chrome, waits for Start, has the 1/2-qubit
 * choice and How to play (with the QAMPoser credit) in its toolbar, switches
 * to German, and remembers the qubit choice under its own key.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, cleanup, screen, fireEvent, act } from '@testing-library/react';
import { LangProvider } from '@shared/i18n';
import { RunnerApp, RUNNER_LEVEL_KEY, SITE_URL, loadLevel } from './RunnerApp';

beforeEach(() => window.localStorage.clear());
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  window.localStorage.clear();
});

function mount(lang: 'en' | 'de' = 'en') {
  return render(
    <LangProvider lang={lang}>
      <RunnerApp autoRun={false} />
    </LangProvider>,
  );
}

describe('RunnerApp — the runner-only shell', () => {
  it('renders the game under its own toolbar, with none of the site chrome', () => {
    const { container } = mount();
    expect(container.querySelector('.pk-runnerapp .pk-runner')).not.toBeNull();
    expect(container.querySelector('.pk-runner-field')).not.toBeNull();
    for (const sel of ['.pk-topbar', '.pk-footer', '.pk-cam', '.pk-gear', '.pk-help', '.pk-transfer-btn', '.pk-golfbar']) {
      expect(container.querySelector(sel), sel).toBeNull();
    }
    // The level picker lives in the toolbar, not twice.
    expect(container.querySelector('.pk-runner-levelpick')).toBeNull();
    expect(screen.getByRole('navigation', { name: 'Quantum Runner controls' })).toBeTruthy();
  });

  it('waits for Start, then counts down 3-2-1 before the run moves', () => {
    vi.useFakeTimers();
    const { container } = mount();
    const root = () => container.querySelector('.pk-runner')!;
    expect(root().getAttribute('data-hold')).toBe('ready');
    expect((screen.getByRole('button', { name: 'Apply H to qubit 0' }) as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    expect(root().getAttribute('data-hold')).toBe('countdown');
    act(() => vi.advanceTimersByTime(3000));
    expect(root().getAttribute('data-hold')).toBe('run');
    expect((screen.getByRole('button', { name: 'Apply H to qubit 0' }) as HTMLButtonElement).disabled).toBe(false);
  });

  it('switches 1 ⇄ 2 qubits from the toolbar and remembers the choice', () => {
    const { container } = mount();
    const two = screen.getByRole('button', { name: '2 qubits' });
    expect(screen.getByRole('button', { name: '1 qubit' }).getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(two);
    expect(two.getAttribute('aria-pressed')).toBe('true');
    expect(container.querySelector('.pk-runner-field')!.getAttribute('data-lanes')).toBe('4');
    expect(screen.getByRole('button', { name: 'Apply CX, control qubit 0, target qubit 1' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Apply CX, control qubit 1, target qubit 0' })).toBeTruthy();
    expect(window.localStorage.getItem(RUNNER_LEVEL_KEY)).toBe('2');
    expect(loadLevel(window.localStorage)).toBe(2);
    expect(loadLevel(null)).toBe(1);
  });

  it('opens How to play (rules, credit, site link), holding the run, and closes it', () => {
    vi.useFakeTimers();
    const { container } = mount();
    fireEvent.click(screen.getByRole('button', { name: 'Start' }));
    act(() => vi.advanceTimersByTime(3000));
    expect(container.querySelector('.pk-runner')!.getAttribute('data-hold')).toBe('run');
    fireEvent.click(screen.getByRole('button', { name: 'How to play' }));
    const dialog = screen.getByRole('dialog', { name: 'How to play' });
    expect(dialog.querySelectorAll('.pk-runnersheet-p').length).toBeGreaterThan(3);
    expect(dialog.textContent).toContain('Based on Quantum Runner by the QAMPoser project.');
    expect(dialog.textContent).toContain('It is a real operation, but not a gate');
    expect(dialog.querySelector('a')!.getAttribute('href')).toBe(SITE_URL);
    // The run is held under the sheet …
    expect(container.querySelector('.pk-runner')!.getAttribute('data-hold')).toBe('paused');
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog', { name: 'How to play' })).toBeNull();
    // … and waits for Resume afterwards.
    expect(screen.getByRole('button', { name: 'Resume' })).toBeTruthy();
  });

  it('switches to German from the toolbar (du, with the German credit)', () => {
    mount();
    fireEvent.click(screen.getByRole('button', { name: 'Auf Deutsch umschalten' }));
    expect(screen.getByRole('button', { name: 'Los' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'H auf Qubit 0 anwenden' })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'So geht’s' }));
    const dialog = screen.getByRole('dialog', { name: 'So geht’s' });
    expect(dialog.textContent).toContain('Nach Quantum Runner vom QAMPoser-Projekt.');
    expect(dialog.textContent).toMatch(/Tippe auf die Gatter/);
    expect(dialog.textContent).toContain('Das ist eine echte Operation, aber kein Gatter');
    expect(screen.getByRole('button', { name: 'Switch to English' })).toBeTruthy();
  });

  it('opens in German when asked (as the device language does)', () => {
    mount('de');
    expect(screen.getByRole('button', { name: '2 Qubits' })).toBeTruthy();
    expect(screen.getByRole('dialog', { name: 'Bereit?' })).toBeTruthy();
  });

  it('has the reset next to pause in its HUD (not in the toolbar or among the gates)', () => {
    const { container } = mount();
    const reset = screen.getByRole('button', { name: 'Reset the qubit to 0' });
    expect(reset.closest('.pk-runner-hud')).not.toBeNull();
    expect(reset.closest('.pk-runnerbar')).toBeNull();
    expect(container.querySelectorAll('.pk-runner-gates button')).toHaveLength(2);
  });

  it('keeps every bundle gate rule at 44 px or more and no six-in-a-row squeeze', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'runner.css'), 'utf8').replace(
      /\/\*[\s\S]*?\*\//g,
      '',
    );
    for (const m of css.matchAll(/pk-runner-gate[^{]*\{([^}]*)\}/g)) {
      const h = /min-height:\s*(\d+)px/.exec(m[1]);
      if (h) expect(Number(h[1])).toBeGreaterThanOrEqual(44);
    }
    expect(css).not.toContain("data-lanes='4'] ~ .pk-runner-gates");
    expect(css).toMatch(/\.pk-runnerapp \.pk-runner-field \{\s*min-height: 6rem;/);
  });
});
