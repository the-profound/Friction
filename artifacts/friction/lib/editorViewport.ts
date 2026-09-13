export interface EditorViewportScrollInput {
  currentScrollTop: number;
  maxScrollTop: number;
  viewportHeight: number;
  marginPx: number;
  obscuredBottomPx?: number;
  caretTop?: number;
  caretBottom?: number;
}

export const MEMO_TOOLBAR_OCCUPIED_HEIGHT = 64;

export interface EditorBottomVisibilityContract {
  contentBottomPadding: number;
  obscuredBottomPx: number;
}

export function resolveEditorBottomVisibility(input: {
  basePadding: number;
  toolbarVisible: boolean;
  toolbarOccupiedHeight: number;
}): EditorBottomVisibilityContract {
  const basePadding = Math.max(0, input.basePadding);
  const obscuredBottomPx = input.toolbarVisible
    ? Math.max(0, input.toolbarOccupiedHeight)
    : 0;
  return {
    contentBottomPadding: basePadding + obscuredBottomPx,
    obscuredBottomPx,
  };
}

export type SelectionEndpoint = "anchor" | "head";

export function resolveActiveSelectionEndpoint(input: {
  touchX: number;
  touchY: number;
  anchorRect: { left: number; right: number; top: number; bottom: number };
  headRect: { left: number; right: number; top: number; bottom: number };
}): SelectionEndpoint {
  const distanceSquared = (
    rect: { left: number; right: number; top: number; bottom: number },
  ) => {
    const x = (rect.left + rect.right) / 2;
    const y = (rect.top + rect.bottom) / 2;
    return (x - input.touchX) ** 2 + (y - input.touchY) ** 2;
  };
  return distanceSquared(input.anchorRect) <= distanceSquared(input.headRect)
    ? "anchor"
    : "head";
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
  obscuredBottomPx = 0,
  caretTop,
  caretBottom,
}: EditorViewportScrollInput): number {
  const safeMaxScrollTop = Math.max(0, maxScrollTop);
  let nextScrollTop = clamp(currentScrollTop, 0, safeMaxScrollTop);

  if (caretTop === undefined || caretBottom === undefined) {
    return nextScrollTop;
  }

  const visibleTop = nextScrollTop + marginPx;
  const visibleBottom =
    nextScrollTop + viewportHeight - marginPx - Math.max(0, obscuredBottomPx);
  if (caretBottom > visibleBottom) {
    nextScrollTop += caretBottom - visibleBottom;
  } else if (caretTop < visibleTop) {
    nextScrollTop -= visibleTop - caretTop;
  }

  return clamp(nextScrollTop, 0, safeMaxScrollTop);
}