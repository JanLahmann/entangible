/**
 * Vertical auto-fit for the recognized-circuit editor — the React side of the
 * pure `editorFit` maths. Measures the stage's available height
 * (ResizeObserver on the editor container) and derives a scale from the
 * editor's natural height (D wires x row height + chrome) so all
 * `displayQubits` wires always fit — no clipping. On roomy iPad/desktop stages
 * the available height already exceeds the natural height, so the scale stays 1
 * and nothing changes there.
 *
 * Shared by the site shell (`App`) and the golf-only bundle (`GolfApp`).
 */
import { useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import { editorFit, editorNaturalHeight, type EditorFit } from './editorFit';

export function useEditorFit(displayQubits: number): {
  containerRef: RefObject<HTMLDivElement>;
  fit: EditorFit & { natural: number };
} {
  const containerRef = useRef<HTMLDivElement>(null);
  const natural = editorNaturalHeight(displayQubits);
  const [fit, setFit] = useState<EditorFit>({ scale: 1, scroll: false });

  useLayoutEffect(() => {
    const measure = () => {
      const container = containerRef.current;
      if (!container) return;
      const next = editorFit(container.clientHeight, natural);
      setFit((prev) => (prev.scale === next.scale && prev.scroll === next.scroll ? prev : next));
    };
    measure();
    const ro = new ResizeObserver(measure);
    if (containerRef.current) ro.observe(containerRef.current);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, [natural]);

  return { containerRef, fit: { ...fit, natural } };
}

/**
 * Inline style for the `.pk-editor-scale` wrapper: `undefined` at scale 1 (the
 * stylesheet's stretch rules apply), else the shrink transform.
 */
export function editorScaleStyle(fit: EditorFit & { natural: number }): CSSProperties | undefined {
  if (!(fit.scale < 1)) return undefined;
  return {
    flex: 'none',
    height: `${fit.natural}px`,
    width: `${100 / fit.scale}%`,
    transform: `scale(${fit.scale})`,
    transformOrigin: 'top left',
    // Reclaim the layout space the shrunk editor no longer occupies (top-left
    // origin leaves scaled-away space to its right and below) so the column
    // doesn't gain phantom horizontal/vertical scroll.
    marginBottom: `${-(fit.natural * (1 - fit.scale))}px`,
    marginRight: `${-(100 / fit.scale - 100)}%`,
  };
}
