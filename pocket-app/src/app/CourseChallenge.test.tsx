// @vitest-environment jsdom
/**
 * #84 — the challenge overlay: a QR of the course share link, opened from the
 * random round's card and closed the way every other pocket overlay closes.
 */
import { describe, it, expect, afterEach } from 'vitest';
import { render, cleanup, screen, fireEvent, waitFor } from '@testing-library/react';
import { CourseChallenge } from './CourseChallenge';
import { courseCode } from '@quantum/golfRandom';

afterEach(cleanup);

const CODE = courseCode(4242);
const LINK = `https://entangible.org/?course=${CODE}`;

describe('CourseChallenge (#84)', () => {
  it('opens an overlay with a QR for the course link, and the code in text', async () => {
    render(<CourseChallenge code={CODE} link={LINK} />);
    // Closed to begin with — it is an offer, not an interruption.
    expect(screen.queryByRole('dialog')).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Multi player — share this course' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toBeTruthy();

    // The QR is rendered as inline SVG by the shared pure-JS renderer (#37) —
    // no canvas, which is why it works here at all.
    await waitFor(() => {
      const svg = dialog.querySelector('.pk-qr-code svg');
      expect(svg).not.toBeNull();
      // A real QR, not an empty frame: it has modules drawn in it.
      expect(svg!.innerHTML.length).toBeGreaterThan(100);
    });

    // The code is readable too, for anyone who would rather type it.
    expect(screen.getByText(`Course #${CODE}`)).toBeTruthy();
    expect(screen.getByText(/Scan to play the same course/)).toBeTruthy();
    expect(screen.getByText(/Compare strokes and time/)).toBeTruthy();
  });

  it('encodes the link it was given, not a rebuilt one', async () => {
    // Two different courses must produce two different QRs; the component never
    // reconstructs the URL, so what is scanned is exactly what was shared.
    const first = render(<CourseChallenge code={CODE} link={LINK} />);
    fireEvent.click(screen.getByRole('button', { name: 'Multi player — share this course' }));
    let markup = '';
    await waitFor(() => {
      markup = first.container.querySelector('.pk-qr-code')!.innerHTML;
      expect(markup.length).toBeGreaterThan(100);
    });
    cleanup();

    const other = render(<CourseChallenge code="zzz" link="https://entangible.org/?course=zzz" />);
    fireEvent.click(screen.getByRole('button', { name: 'Multi player — share this course' }));
    await waitFor(() => {
      const second = other.container.querySelector('.pk-qr-code')!.innerHTML;
      expect(second.length).toBeGreaterThan(100);
      expect(second).not.toBe(markup);
    });
  });

  it('closes on the X and on a tap outside, like every other pocket overlay', async () => {
    render(<CourseChallenge code={CODE} link={LINK} />);
    const open = () =>
      fireEvent.click(screen.getByRole('button', { name: 'Multi player — share this course' }));

    open();
    fireEvent.click(screen.getByRole('button', { name: 'Close' }));
    expect(screen.queryByRole('dialog')).toBeNull();

    open();
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).toBeNull();

    // …but a tap INSIDE the card keeps it open (the card stops propagation).
    open();
    await waitFor(() => expect(screen.getByText(`Course #${CODE}`)).toBeTruthy());
    fireEvent.click(screen.getByText(`Course #${CODE}`));
    expect(screen.queryByRole('dialog')).not.toBeNull();
  });
});
