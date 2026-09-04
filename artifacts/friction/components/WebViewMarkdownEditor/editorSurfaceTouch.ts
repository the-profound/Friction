export const SURFACE_TAP_THRESHOLD = 10;

const EDITOR_OWNED_TARGET_SELECTOR = [
  "#title-input",
  ".ProseMirror",
  ".hr-wrapper",
  "button",
  "input",
  "textarea",
  "select",
  "a",
  "[role='button']",
].join(", ");

export interface EditorSurfaceTouchSession {
  startX: number;
  startY: number;
  moved: boolean;
  scrolled: boolean;
  startedOnBlankSurface: boolean;
}

export function isBlankEditorSurfaceTarget(target: EventTarget | null): boolean {
  return (
    typeof Element !== "undefined"
    && target instanceof Element
    && !target.closest(EDITOR_OWNED_TARGET_SELECTOR)
  );
}

export function createEditorSurfaceTouchSession(
  x: number,
  y: number,
  startedOnBlankSurface: boolean,
): EditorSurfaceTouchSession {
  return {
    startX: x,
    startY: y,
    moved: false,
    scrolled: false,
    startedOnBlankSurface,
  };
}

export function updateEditorSurfaceTouchSession(
  session: EditorSurfaceTouchSession,
  x: number,
  y: number,
): void {
  if (
    Math.abs(x - session.startX) >= SURFACE_TAP_THRESHOLD
    || Math.abs(y - session.startY) >= SURFACE_TAP_THRESHOLD
  ) {
    session.moved = true;
  }
}

export function isStationaryBlankSurfaceTap(
  session: EditorSurfaceTouchSession,
  x: number,
  y: number,
  endedOnBlankSurface: boolean,
): boolean {
  updateEditorSurfaceTouchSession(session, x, y);
  return (
    session.startedOnBlankSurface
    && endedOnBlankSurface
    && !session.moved
    && !session.scrolled
  );
}