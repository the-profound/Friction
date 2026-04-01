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
  if (totalPages <= 0) return 0;
  return Math.min(1, (currentPage + 1) / totalPages);
}

export function shouldShowExitUI(mode: ReadingMode): boolean {
  return mode === "re_read";
}

export function isLastPage(currentPage: number, totalPages: number): boolean {
  return currentPage >= totalPages - 1;
}

export function createInitialSession(
  articleId: string,
  mode: ReadingMode,
  totalPages: number,
  savedPosition?: { currentPage: number; scrollPosition: number },
): ReadingSession {
  return {
    articleId,
    mode,
    state: "IDLE",
    position: {
      currentPage: savedPosition?.currentPage ?? 0,
      scrollPosition: savedPosition?.scrollPosition ?? 0,
      totalPages,
    },
  };
}

export function advancePage(session: ReadingSession): ReadingSession {
  const { position } = session;
  if (position.currentPage >= position.totalPages - 1) {
    return session;
  }
  return {
    ...session,
    position: {
      ...position,
      currentPage: position.currentPage + 1,
      scrollPosition: 0,
    },
  };
}

export function goToPreviousPage(session: ReadingSession): ReadingSession {
  const { position } = session;
  if (position.currentPage <= 0) return session;
  return {
    ...session,
    position: {
      ...position,
      currentPage: position.currentPage - 1,
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
