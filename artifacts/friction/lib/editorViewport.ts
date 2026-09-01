export interface EditorViewportScrollInput {
  currentScrollTop: number;
  maxScrollTop: number;
  viewportHeight: number;
  marginPx: number;
  caretTop?: number;
  caretBottom?: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(min, value), max);
}

/**
 * Returns a valid document scroll offset while moving the caret only when it
 * falls outside the actual visible editor viewport.
 */
export function computeEditorViewportScrollTop({
  currentScrollTop,
  maxScrollTop,
  viewportHeight,
  marginPx,
  caretTop,
  caretBottom,
}: EditorViewportScrollInput): number {
  const safeMaxScrollTop = Math.max(0, maxScrollTop);
  let nextScrollTop = clamp(currentScrollTop, 0, safeMaxScrollTop);

  if (caretTop === undefined || caretBottom === undefined) {
    return nextScrollTop;
  }

  const visibleTop = nextScrollTop + marginPx;
  const visibleBottom = nextScrollTop + viewportHeight - marginPx;
  if (caretBottom > visibleBottom) {
    nextScrollTop += caretBottom - visibleBottom;
  } else if (caretTop < visibleTop) {
    nextScrollTop -= visibleTop - caretTop;
  }

  return clamp(nextScrollTop, 0, safeMaxScrollTop);
}