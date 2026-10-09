/**
 * The seam around every lazily loaded part of the app (code splitting).
 *
 * The cold welcome path ships only what that screen needs; the Guide, the
 * Runner game, the Quantina menu, the debug panel and the kiosk / `/debug`
 * surfaces arrive as separate chunks the first time they are shown
 * (`React.lazy`). Each such part sits inside a `LazyBoundary`:
 *
 *  - while its chunk downloads, a small `role="status"` "Loading…" note shows
 *    (or the caller's own fallback — e.g. the boot splash for a whole surface);
 *  - if the chunk can't be fetched — an offline booth, or a stale page asking
 *    for a file a new release has replaced — the part becomes a short message
 *    with a Reload button instead of white-screening the whole app.
 *
 * Chunks are local files next to index.html (relative `base: './'`), so a booth
 * served by the host stays fully offline; nothing here touches the network
 * except the browser's own module fetch.
 */
import { Component, Suspense, type ErrorInfo, type ReactNode } from 'react';

/** The default Suspense fallback: a quiet, accessible loading note. */
export function LoadingNote({ overlay = false }: { overlay?: boolean }) {
  return (
    <div className={`pk-lazy-loading${overlay ? ' pk-lazy-loading--overlay' : ''}`} role="status">
      Loading…
    </div>
  );
}

/**
 * The boot splash as React renders it — the same markup and classes as the
 * static splash inside index.html's #root (styled there, inline), so a whole
 * surface that is still loading (kiosk, `/debug`) shows no visual jump.
 */
export function BootSplash() {
  return (
    <div className="boot-splash" role="status">
      <div className="boot-splash__brand">
        <span className="boot-splash__en">En</span>tangible
      </div>
      <div className="boot-splash__line">Build quantum circuits with your hands</div>
    </div>
  );
}

/** What a failed chunk load leaves behind: a short note and a way back. */
export function LoadFailed({ overlay = false }: { overlay?: boolean }) {
  return (
    <div className={`pk-lazy-error${overlay ? ' pk-lazy-error--overlay' : ''}`} role="alert">
      <span>This part of Entangible didn’t load — the connection dropped, or the site was just updated.</span>
      <button type="button" className="pk-btn" onClick={() => window.location.reload()}>
        Reload
      </button>
    </div>
  );
}

interface BoundaryProps {
  children: ReactNode;
  /** Suspense fallback; defaults to the small "Loading…" note. */
  fallback?: ReactNode;
  /** Render the loading / failure notes as a centred overlay (full-screen parts). */
  overlay?: boolean;
}

interface BoundaryState {
  failed: boolean;
}

/** Error boundary + Suspense for one lazily loaded part. */
export class LazyBoundary extends Component<BoundaryProps, BoundaryState> {
  state: BoundaryState = { failed: false };

  static getDerivedStateFromError(): BoundaryState {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // Keep the cause visible to whoever opens the console at the booth.
    console.error('Entangible: a lazily loaded part failed', error, info.componentStack);
  }

  render() {
    const { children, fallback, overlay = false } = this.props;
    if (this.state.failed) return <LoadFailed overlay={overlay} />;
    return <Suspense fallback={fallback ?? <LoadingNote overlay={overlay} />}>{children}</Suspense>;
  }
}
