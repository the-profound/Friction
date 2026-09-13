export interface ReadingSaveBoundary {
  readonly signal: AbortSignal;
  canDispatch: (userId: string, articleId: string) => boolean;
  beginDispatch: (replaceInFlight?: boolean) => AbortSignal;
  dispose: () => void;
}

/**
 * Owns every debounced progress write for one mounted reading identity.
 * Disposing the protected screen blocks queued callbacks and aborts a fetch
 * that started before the account-specific navigation tree unmounted.
 */
export function createReadingSaveBoundary(
  ownerUserId: string,
  ownerArticleId: string,
): ReadingSaveBoundary {
  let latestController = new AbortController();
  const controllers = new Set<AbortController>([latestController]);
  let active = true;

  return {
    get signal() {
      return latestController.signal;
    },
    canDispatch(userId, articleId) {
      return (
        active &&
        userId === ownerUserId &&
        articleId === ownerArticleId
      );
    },
    beginDispatch(replaceInFlight = false) {
      if (replaceInFlight) {
        for (const controller of controllers) controller.abort();
        controllers.clear();
      }
      latestController = new AbortController();
      controllers.add(latestController);
      return latestController.signal;
    },
    dispose() {
      if (!active) return;
      active = false;
      for (const controller of controllers) controller.abort();
      controllers.clear();
    },
  };
}