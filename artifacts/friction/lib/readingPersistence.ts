import type { ReadingMode } from "./policies";

export type ReadingSessionState =
  | "IDLE"
  | "READING"
  | "PAUSED"
  | "COMPLETED_READY"
  | "COMPLETED_COMMITTED";

export interface ReadingPosition {
  currentPage: number;
  scrollPosition: number;
  totalPages: number;
}

export interface ReadingSession {
  articleId: string;
  mode: ReadingMode;
  state: ReadingSessionState;
  position: ReadingPosition;
}

/**
 * Normalizes a reader page index. The reader reserves `totalPages` as the
 * question-card virtual page, so it is intentionally included in the range.
 * Keeping this normalization here makes stale persisted positions harmless
 * before they reach the reader pager.
 */
export function clampReadingPage(currentPage: number, totalPages: number): number {
  const safeTotalPages = Number.isFinite(totalPages)
    ? Math.max(0, Math.floor(totalPages))
    : 0;
  const safeCurrentPage = Number.isFinite(currentPage)
    ? Math.floor(currentPage)
    : 0;
  return Math.min(safeTotalPages, Math.max(0, safeCurrentPage));
}

/**
 * Maps the reading-session page to the single pager's visible page. Letter
 * pages and the question card share the session index; the completion screen
 * is the one additional virtual page.
 */
export function getVisualReadingPage(
  currentPage: number,
  totalPages: number,
  completeScreenVisible: boolean,
): number {
  const safeTotalPages = Number.isFinite(totalPages)
    ? Math.max(0, Math.floor(totalPages))
    : 0;
  if (safeTotalPages === 0) return 0;
  return completeScreenVisible
    ? safeTotalPages + 1
    : clampReadingPage(currentPage, safeTotalPages);
}

/**
 * An in-flight pager animation is valid only while the virtual-page topology
 * it started from is still current. A page-count change can otherwise turn a
 * last-letter transition into a question/completion transition before its
 * animation callback reaches JS.
 */
export function isCurrentReadingPagerTransition(
  sourceVisualPage: number,
  sourceTotalPages: number,
  currentVisualPage: number,
  currentTotalPages: number,
): boolean {
  const safeSourceTotalPages = Number.isFinite(sourceTotalPages)
    ? Math.max(0, Math.floor(sourceTotalPages))
    : 0;
  const safeCurrentTotalPages = Number.isFinite(currentTotalPages)
    ? Math.max(0, Math.floor(currentTotalPages))
    : 0;
  return safeSourceTotalPages > 0
    && safeSourceTotalPages === safeCurrentTotalPages
    && Number.isInteger(sourceVisualPage)
    && sourceVisualPage >= 0
    && sourceVisualPage <= safeSourceTotalPages + 1
    && sourceVisualPage === currentVisualPage;
}

const TRANSITIONS: Record<ReadingSessionState, ReadingSessionState[]> = {
  IDLE: ["READING"],
  READING: ["PAUSED", "COMPLETED_READY"],
  PAUSED: ["READING", "IDLE"],
  COMPLETED_READY: ["COMPLETED_COMMITTED", "READING"],
  COMPLETED_COMMITTED: ["IDLE"],
};

export function canTransitionSession(
  from: ReadingSessionState,
  to: ReadingSessionState,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export function transitionSession(
  from: ReadingSessionState,
  to: ReadingSessionState,
): { allowed: true; state: ReadingSessionState } | { allowed: false; reason: string } {
  if (!canTransitionSession(from, to)) {
    return { allowed: false, reason: `${from}에서 ${to}(으)로 전환할 수 없습니다.` };
  }
  return { allowed: true, state: to };
}

export function shouldBlockExit(mode: ReadingMode, state: ReadingSessionState): boolean {
  return mode === "basic" && state !== "IDLE" && state !== "COMPLETED_COMMITTED";
}

export function shouldBlockBack(mode: ReadingMode, state: ReadingSessionState): boolean {
  return mode === "basic" && (state === "READING" || state === "COMPLETED_READY");
}

export function shouldForceReturnToRead(
  mode: ReadingMode,
  activeArticleId: string | null,
): boolean {
  return mode === "basic" && activeArticleId != null;
}

export function isCompleted(state: ReadingSessionState): boolean {
  return state === "COMPLETED_READY" || state === "COMPLETED_COMMITTED";
}

export function isReading(state: ReadingSessionState): boolean {
  return state === "READING" || state === "PAUSED";
}

export function getProgress(currentPage: number, totalPages: number): number {
  const safeTotalPages = Number.isFinite(totalPages)
    ? Math.max(0, Math.floor(totalPages))
    : 0;
  if (safeTotalPages <= 0) return 0;
  return Math.min(1, (clampReadingPage(currentPage, safeTotalPages) + 1) / safeTotalPages);
}

export function shouldShowExitUI(mode: ReadingMode): boolean {
  return mode === "re_read";
}

export function isLastPage(currentPage: number, totalPages: number): boolean {
  const safeTotalPages = Number.isFinite(totalPages)
    ? Math.max(0, Math.floor(totalPages))
    : 0;
  return safeTotalPages > 0
    && clampReadingPage(currentPage, safeTotalPages) >= safeTotalPages - 1;
}

export function createInitialSession(
  articleId: string,
  mode: ReadingMode,
  totalPages: number,
  savedPosition?: { currentPage: number; scrollPosition: number },
): ReadingSession {
  const startsFromBeginning = mode === "re_read";
  return {
    articleId,
    mode,
    state: "IDLE",
    position: {
      currentPage: startsFromBeginning
        ? 0
        : clampReadingPage(savedPosition?.currentPage ?? 0, totalPages),
      scrollPosition: startsFromBeginning ? 0 : savedPosition?.scrollPosition ?? 0,
      totalPages,
    },
  };
}

export function advancePage(session: ReadingSession): ReadingSession {
  const { position } = session;
  const currentPage = clampReadingPage(position.currentPage, position.totalPages);
  if (currentPage >= position.totalPages) {
    return currentPage === position.currentPage
      ? session
      : {
          ...session,
          position: { ...position, currentPage, scrollPosition: 0 },
        };
  }
  return {
    ...session,
    position: {
      ...position,
      currentPage: currentPage + 1,
      scrollPosition: 0,
    },
  };
}

export function goToPreviousPage(session: ReadingSession): ReadingSession {
  const { position } = session;
  const currentPage = clampReadingPage(position.currentPage, position.totalPages);
  if (currentPage <= 0) {
    return currentPage === position.currentPage
      ? session
      : {
          ...session,
          position: { ...position, currentPage, scrollPosition: 0 },
        };
  }
  return {
    ...session,
    position: {
      ...position,
      currentPage: currentPage - 1,
      scrollPosition: 0,
    },
  };
}

export function updateScrollPosition(session: ReadingSession, scrollPosition: number): ReadingSession {
  return {
    ...session,
    position: {
      ...session.position,
      scrollPosition: Math.max(0, Math.min(1, scrollPosition)),
    },
  };
}

export function markCompletedReady(session: ReadingSession): ReadingSession | null {
  if (session.state !== "READING") return null;
  if (!isLastPage(session.position.currentPage, session.position.totalPages)) return null;
  return { ...session, state: "COMPLETED_READY" };
}
