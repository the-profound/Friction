/**
 * Tracks whether a "review → closing" stage transition that this screen
 * itself started is still in flight.
 *
 * The transition optimistically patches the article's own cached status
 * before navigation away completes, which would otherwise make this screen
 * briefly misclassify its own (still-focused) record as invalid. This
 * controller lets the screen suppress exactly that one false positive for
 * the transition it initiated, and guarantees the suppression is lifted —
 * with a signal to force a fresh render — whenever the screen regains focus,
 * so a genuine error (deletion, a failed/aborted transition, or the user
 * simply returning here) is detected normally again.
 */
export interface ClosingTransitionSuppressionController {
  /** Call synchronously, before the optimistic status patch, to begin suppression. */
  begin(): void;
  /** Whether the false-positive "not-dividing" classification should currently be suppressed. */
  isPending(): boolean;
  /**
   * Call on every screen focus. Clears suppression if it was pending and
   * returns true when it did — the caller must then force a re-render, since
   * clearing a plain flag does not itself trigger one.
   */
  handleFocus(): boolean;
}

export function createClosingTransitionSuppressionController(): ClosingTransitionSuppressionController {
  let pending = false;
  return {
    begin() {
      pending = true;
    },
    isPending() {
      return pending;
    },
    handleFocus() {
      if (!pending) return false;
      pending = false;
      return true;
    },
  };
}
