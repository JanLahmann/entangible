import { describe, it, expect } from 'vitest';
import { detectSurface } from './surface';

describe('detectSurface', () => {
  it('defaults to the standalone app', () => {
    expect(detectSurface('/', '')).toBe('app');
    expect(detectSurface('/', '?connect=1')).toBe('app');
    // GH Pages / project-page base paths still read as the app.
    expect(detectSurface('/QAMPoser-physical/', '')).toBe('app');
  });

  it('routes /debug (and variants) to the debug surface', () => {
    expect(detectSurface('/debug', '')).toBe('debug');
    expect(detectSurface('/debug/', '')).toBe('debug');
    expect(detectSurface('/base/debug', '?key=abc')).toBe('debug');
  });

  it('selects the kiosk skin on ?kiosk (bare or truthy)', () => {
    expect(detectSurface('/', '?kiosk')).toBe('kiosk');
    expect(detectSurface('/', '?kiosk=1')).toBe('kiosk');
    expect(detectSurface('/', '?kiosk&connect=1')).toBe('kiosk');
    expect(detectSurface('/', 'kiosk=true')).toBe('kiosk');
  });

  it('lets ?kiosk=0 / false / off opt back out', () => {
    expect(detectSurface('/', '?kiosk=0')).toBe('app');
    expect(detectSurface('/', '?kiosk=false')).toBe('app');
    expect(detectSurface('/', '?kiosk=off')).toBe('app');
  });

  it('prefers /debug over ?kiosk when both are present', () => {
    expect(detectSurface('/debug', '?kiosk')).toBe('debug');
  });
});
