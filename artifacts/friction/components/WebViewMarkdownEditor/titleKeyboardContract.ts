export interface TitleKeyboardEventLike {
  key: string;
  shiftKey: boolean;
  isComposing: boolean;
  keyCode: number;
}

export interface TitleKeyboardActions {
  preventDefault: () => void;
  focusBodyStart: () => void;
}

export interface TitleSoftBreakResult {
  value: string;
  caret: number;
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

/**
 * Runs the shared title Enter behavior used by both the web textarea and the
 * native WebView textarea. Returning false leaves the event completely alone,
 * so the textarea owns Shift+Enter and an IME can finish composing.
 */
export function handleTitleEnter(
  event: TitleKeyboardEventLike,
  actions: TitleKeyboardActions,
  compositionActive = false,
): boolean {
  if (!shouldMoveTitleFocusToBody(event, compositionActive)) {
    return false;
  }

  actions.preventDefault();
  actions.focusBodyStart();
  return true;
}

export function insertTitleSoftBreak(
  value: string,
  selectionStart: number | null,
  selectionEnd: number | null,
): TitleSoftBreakResult {
  const start = selectionStart ?? value.length;
  const end = selectionEnd ?? start;
  return {
    value: `${value.slice(0, start)}\n${value.slice(end)}`,
    caret: start + 1,
  };
}
