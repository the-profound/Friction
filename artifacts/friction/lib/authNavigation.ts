export const AUTH_BYPASS_ROUTES = new Set(["login", "login-callback"]);

export type AuthNavigationDecision =
  | { kind: "loading" }
  | { kind: "redirect-login" }
  | { kind: "public" }
  | { kind: "protected"; userId: string };

export function getAuthNavigationDecision({
  isLoading,
  userId,
  firstSegment,
}: {
  isLoading: boolean;
  userId: string | null | undefined;
  firstSegment: string | undefined;
}): AuthNavigationDecision {
  if (isLoading) return { kind: "loading" };
  if (userId) return { kind: "protected", userId };
  if (firstSegment && AUTH_BYPASS_ROUTES.has(firstSegment)) {
    return { kind: "public" };
  }
  return { kind: "redirect-login" };
}

export interface ActiveReadingOwner {
  userId: string;
}

/**
 * An active reading record is only safe to restore when it was written by the
 * currently authenticated account. Records written before owner tracking was
 * introduced are intentionally not recoverable.
 */
export function getActiveReadingForUser<T extends ActiveReadingOwner>(
  activeSession: T | null,
  userId: string | null | undefined,
): T | null {
  if (!activeSession || !userId || activeSession.userId !== userId) return null;
  return activeSession;
}