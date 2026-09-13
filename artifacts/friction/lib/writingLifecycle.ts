export type WritingAppState =
  | "active"
  | "inactive"
  | "background"
  | "unknown"
  | "extension";

/**
 * iOS commonly reports active → inactive → background for one interruption.
 * Only the first transition starts a writing suspension boundary.
 */
export function entersWritingSuspension(
  previousState: WritingAppState,
  nextState: WritingAppState,
): boolean {
  return (
    nextState !== "active"
    && (previousState === "active" || previousState === "unknown")
  );
}

export function resumesWritingFromSuspension(
  previousState: WritingAppState,
  nextState: WritingAppState,
): boolean {
  return previousState !== "active" && nextState === "active";
}

type FlushReason = "suspend" | "editor-blur";
type TimerHandle = ReturnType<typeof setTimeout>;

/**
 * Coalesces the WebView focus loss that accompanies iOS suspension with the
 * AppState event for that same interruption. A normal keyboard dismissal still
 * flushes on the next turn when the app remains active.
 */
export class WritingLifecycleFlushCoordinator {
  private previousState: WritingAppState;
  private pendingBlurTimer: TimerHandle | null = null;
  private blurFlushCoversNextSuspension = false;

  constructor(
    initialState: WritingAppState,
    private readonly requestFlush: (reason: FlushReason) => void,
  ) {
    this.previousState = initialState;
  }

  handleAppStateChange(nextState: WritingAppState): void {
    const shouldSuspend = entersWritingSuspension(this.previousState, nextState);
    const shouldResume = resumesWritingFromSuspension(this.previousState, nextState);
    this.previousState = nextState;
    if (shouldResume) {
      this.blurFlushCoversNextSuspension = false;
      return;
    }
    if (!shouldSuspend) return;

    this.cancelPendingBlur();
    if (this.blurFlushCoversNextSuspension) {
      this.blurFlushCoversNextSuspension = false;
      return;
    }
    this.requestFlush("suspend");
  }

  handleEditorFocus(): void {
    this.cancelPendingBlur();
    this.blurFlushCoversNextSuspension = false;
  }

  handleEditorBlur(): void {
    this.cancelPendingBlur();
    this.pendingBlurTimer = setTimeout(() => {
      this.pendingBlurTimer = null;
      if (this.previousState === "active") {
        this.blurFlushCoversNextSuspension = true;
        this.requestFlush("editor-blur");
      }
    }, 0);
  }

  dispose(): void {
    this.cancelPendingBlur();
    this.blurFlushCoversNextSuspension = false;
  }

  private cancelPendingBlur(): void {
    if (!this.pendingBlurTimer) return;
    clearTimeout(this.pendingBlurTimer);
    this.pendingBlurTimer = null;
  }
}