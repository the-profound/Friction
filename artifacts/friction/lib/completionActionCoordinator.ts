export type CompletionActionKind = "save" | "reply" | "exit";

export interface CompletionActionLock {
  current: CompletionActionKind | null;
}

interface LaunchCompletionActionOptions {
  lock: CompletionActionLock;
  action: CompletionActionKind;
  onStart: () => void;
  work: () => Promise<void>;
  onSuccess?: () => void;
  onError: (error: unknown) => void;
  onFinally: () => void;
}

/**
 * Claims one completion action synchronously, applies its immediate UI effect,
 * and lets persistence settle without blocking the caller.
 */
export function launchCompletionAction({
  lock,
  action,
  onStart,
  work,
  onSuccess,
  onError,
  onFinally,
}: LaunchCompletionActionOptions): boolean {
  if (lock.current) return false;
  lock.current = action;
  onStart();

  void Promise.resolve()
    .then(work)
    .then(onSuccess)
    .catch(onError)
    .finally(() => {
      if (lock.current === action) {
        lock.current = null;
      }
      onFinally();
    });

  return true;
}