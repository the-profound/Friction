/**
 * Single source of truth for the vertical bottom-offset used by every
 * keyboard-anchored floating surface on the writing screen (floating
 * MemoToolbar, the [+] AddMenuPopup, and InlineMenuPanel).
 *
 * Before this existed, on-01a.tsx computed the toolbar's bottom offset with
 * one inline ternary, InlineMenuPanel's height with a second (duplicated)
 * expression, and AddMenuPopup was fed the raw, unfallback-ed keyboard
 * height. Because the inline-panel flow deliberately calls
 * `Keyboard.dismiss()` before opening (native keyboardVisible becomes
 * false while the panel/toolbar stay visible), any call site that forgot
 * the "use the last known height, else estimate" fallback would render at
 * a different offset than its siblings — the visible "double jump" this
 * module exists to prevent.
 */
export const INLINE_PANEL_FALLBACK_MAX_PX = 320;
export const INLINE_PANEL_FALLBACK_SCREEN_RATIO = 0.4;

export interface FloatingChromeOffsetInput {
  /** Whether the native keyboard is currently reported as visible. */
  keyboardVisible: boolean;
  /** Current native keyboard height (0 when hidden). */
  keyboardHeight: number;
  /**
   * Height from the most recent keyboard show event, retained across a
   * `Keyboard.dismiss()` so chrome that stays visible while the keyboard is
   * down (inline panels) does not collapse to 0.
   */
  lastKnownKeyboardHeight: number;
  /** Window height, used only when no keyboard height has ever been seen. */
  screenHeight: number;
}

/**
 * Resolve the one bottom offset every keyboard-anchored floating surface on
 * the writing screen must use. Callers must never recompute this
 * independently — divergent call sites are exactly what causes the visible
 * jump between the toolbar, the add-menu popup, and the inline panel during
 * a keyboard/panel transition.
 */
export function resolveFloatingChromeOffset({
  keyboardVisible,
  keyboardHeight,
  lastKnownKeyboardHeight,
  screenHeight,
}: FloatingChromeOffsetInput): number {
  if (keyboardVisible) return keyboardHeight;
  if (lastKnownKeyboardHeight > 0) return lastKnownKeyboardHeight;
  return Math.min(
    INLINE_PANEL_FALLBACK_MAX_PX,
    Math.round(screenHeight * INLINE_PANEL_FALLBACK_SCREEN_RATIO),
  );
}
