export interface TitleKeyboardEventLike {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}

/**
 * A title owns Shift+Enter soft breaks. Plain Enter only moves to the body
 * after the browser has finished any active IME composition.
 */
export function shouldMoveTitleFocusToBody(
  event: TitleKeyboardEventLike,
  compositionActive = false,
): boolean {
  return (
    event.key === "Enter"
    && !event.shiftKey
    && !event.isComposing
    && !compositionActive
    && event.keyCode !== 229
  );
}