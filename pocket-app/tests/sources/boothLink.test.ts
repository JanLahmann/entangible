import { describe, it, expect, beforeEach } from 'vitest';
import { boothLink } from '../../src/app/boothLink';
import { connectRequested } from '../../src/sources/boothUrl';

beforeEach(() => boothLink.disconnect());

describe('boothLink store', () => {
  it('normalizes on connect and clears on disconnect', () => {
    expect(boothLink.get().url).toBeNull();
    expect(boothLink.connect('https://booth.local:8443')).toBe(true);
    expect(boothLink.get().url).toBe('wss://booth.local:8443/ws/state');
    boothLink.disconnect();
    expect(boothLink.get().url).toBeNull();
  });

  it('rejects an unusable address without changing state', () => {
    expect(boothLink.connect('   ')).toBe(false);
    expect(boothLink.get().url).toBeNull();
  });

  it('notifies subscribers on change and dedupes identical connects', () => {
    let notifications = 0;
    const unsub = boothLink.subscribe(() => (notifications += 1));
    boothLink.connect('wss://booth.local:8443');
    boothLink.connect('wss://booth.local:8443/ws/state'); // same normalized url → no emit
    expect(notifications).toBe(1);
    unsub();
  });
});

describe('?connect=1 auto-connect wiring', () => {
  // Models exactly what App's mount effect does: if the URL asks to connect,
  // join the serving host (here a stand-in for defaultStateUrl()).
  function autoConnect(search: string, hostStateUrl: string): void {
    if (connectRequested(search)) boothLink.connect(hostStateUrl);
  }

  it('connects to the serving host when ?connect=1 is present', () => {
    autoConnect('?connect=1', 'wss://booth.local:8443/ws/state');
    expect(boothLink.get().url).toBe('wss://booth.local:8443/ws/state');
  });

  it('does nothing without the connect flag (standalone entangible.org)', () => {
    autoConnect('?mode=golf', 'wss://booth.local:8443/ws/state');
    expect(boothLink.get().url).toBeNull();
  });
});
