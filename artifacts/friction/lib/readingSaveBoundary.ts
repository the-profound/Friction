export interface ReadingSaveBoundary {
  signal: AbortSignal;
  canDispatch: (userId: string, articleId: string) => boolean;
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
  const controller = new AbortController();
  let active = true;

  return {
    signal: controller.signal,
    canDispatch(userId, articleId) {
      return (
        active &&
        !controller.signal.aborted &&
        userId === ownerUserId &&
        articleId === ownerArticleId
      );
    },
    dispose() {
      if (!active) return;
      active = false;
      controller.abort();
    },
  };
}