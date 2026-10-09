import { useT } from '@shared/i18n';

/**
 * ResetOrientationButton — the Q-sphere/Bloch "return to default orientation"
 * control, shared by both apps. A small rewind-arrow icon button pinned to the
 * top-right of the view panel, matching the IBM Quantum Composer convention
 * ("select the rewind-arrow button to return to its default orientation").
 * Structural only; `${classPrefix}-qs-reset` carries the styling.
 */
export function ResetOrientationButton({
  classPrefix,
  onReset,
}: {
  classPrefix: string;
  onReset: () => void;
}) {
  const label = useT().evolving.resetOrientation;
  return (
    <button
      type="button"
      className={`${classPrefix}-qs-reset`}
      aria-label={label}
      title={label}
      onClick={onReset}
      onPointerDown={(e) => e.stopPropagation()}
    >
      <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
        {/* counter-clockwise rewind arrow */}
        <path
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          d="M4 9a8 8 0 1 1-1.5 5"
        />
        <path fill="currentColor" d="M3 4.5 8 8 3.5 9.2z" />
      </svg>
    </button>
  );
}

export default ResetOrientationButton;
