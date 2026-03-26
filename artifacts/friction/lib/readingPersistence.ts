import type { ReadingMode } from "./policies";

export type ReadingSessionState =
  | "IDLE"
  | "READING"
  | "PAUSED"
  | "COMPLETED_READY"
  | "COMPLETED_COMMITTED";

export interface ReadingRecord {
  articleId: string;
  currentPage: number;
  totalPages: number;
  mode: ReadingMode;
  sessionState: ReadingSessionState;
  activeArticleId: string | null;
}

interface ReadingSessionActions {
  onPageChange: (page: number) => void;
  onComplete: () => void;
  onCommit: (action: "save" | "delete") => Promise<void>;
  onPause: () => void;
  onResume: () => void;
}

const TRANSITIONS: Record<ReadingSessionState, ReadingSessionState[]> = {
  IDLE: ["READING"],
  READING: ["PAUSED", "COMPLETED_READY"],
  PAUSED: ["READING", "IDLE"],
  COMPLETED_READY: ["COMPLETED_COMMITTED"],
  COMPLETED_COMMITTED: ["IDLE"],
};

export function canTransitionSession(
  from: ReadingSessionState,
  to: ReadingSessionState,
): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
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

export function getProgress(currentPage: number, totalPages: number): number {
  if (totalPages <= 0) return 0;
  return Math.min(1, (currentPage + 1) / totalPages);
}

export function shouldShowExitUI(mode: ReadingMode): boolean {
  return mode === "re_read";
}
