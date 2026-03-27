import { useCallback, useRef, useState } from "react";
import { useUpsertReadingRecord, useCreateUserArticleRead, useMarkInboxRead } from "@workspace/api-client-react";
import type { ReadingMode } from "./policies";
import {
  createInitialSession,
  advancePage,
  goToPreviousPage,
  updateScrollPosition,
  markCompletedReady,
  canTransitionSession,
  isLastPage,
  getProgress,
  shouldBlockExit,
  shouldShowExitUI,
} from "./readingPersistence";
import type { ReadingSession, ReadingSessionState } from "./readingPersistence";

const POSITION_SAVE_DEBOUNCE_MS = 2000;

export interface UseReadingSessionOptions {
  articleId: string;
  mode: ReadingMode;
  totalPages: number;
  userId: string;
  savedPosition?: { currentPage: number; scrollPosition: number };
  inboxId?: string;
}

export interface ReadingSessionActions {
  session: ReadingSession;
  progress: number;
  canExit: boolean;
  showExitUI: boolean;
  nextPage: () => void;
  prevPage: () => void;
  onScroll: (scrollPosition: number) => void;
  startReading: () => void;
  pause: () => void;
  resume: () => void;
  commitCompletion: () => Promise<{ success: boolean; error?: string }>;
}

export function useReadingSession({
  articleId,
  mode,
  totalPages,
  userId,
  savedPosition,
  inboxId,
}: UseReadingSessionOptions): ReadingSessionActions {
  const [session, setSession] = useState<ReadingSession>(() =>
    createInitialSession(articleId, mode, totalPages, savedPosition),
  );

  const upsertReading = useUpsertReadingRecord();
  const createArticleRead = useCreateUserArticleRead();
  const markInboxReadMutation = useMarkInboxRead();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inboxIdRef = useRef(inboxId);

  const savePosition = useCallback(
    (currentPage: number, scrollPosition: number) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        try {
          await upsertReading.mutateAsync({
            data: { userId, articleId, currentPage, scrollPosition },
          });
        } catch {
        }
      }, POSITION_SAVE_DEBOUNCE_MS);
    },
    [userId, articleId, upsertReading],
  );

  const startReading = useCallback(() => {
    if (!canTransitionSession(session.state, "READING")) return;
    setSession((s) => ({ ...s, state: "READING" }));
  }, [session.state]);

  const pause = useCallback(() => {
    if (!canTransitionSession(session.state, "PAUSED")) return;
    setSession((s) => ({ ...s, state: "PAUSED" }));
    savePosition(session.position.currentPage, session.position.scrollPosition);
  }, [session.state, session.position, savePosition]);

  const resume = useCallback(() => {
    if (!canTransitionSession(session.state, "READING")) return;
    setSession((s) => ({ ...s, state: "READING" }));
  }, [session.state]);

  const nextPage = useCallback(() => {
    setSession((prev) => {
      const next = advancePage(prev);
      if (next !== prev) {
        savePosition(next.position.currentPage, 0);
      }
      if (isLastPage(next.position.currentPage, next.position.totalPages) && next.state === "READING") {
        const completed = markCompletedReady(next);
        if (completed) return completed;
      }
      return next;
    });
  }, [savePosition]);

  const prevPage = useCallback(() => {
    setSession((prev) => {
      const next = goToPreviousPage(prev);
      if (next !== prev) {
        savePosition(next.position.currentPage, 0);
      }
      return next;
    });
  }, [savePosition]);

  const onScroll = useCallback(
    (scrollPosition: number) => {
      setSession((prev) => updateScrollPosition(prev, scrollPosition));
      savePosition(session.position.currentPage, scrollPosition);
    },
    [session.position.currentPage, savePosition],
  );

  const commitCompletion = useCallback(async () => {
    if (session.state !== "COMPLETED_READY") {
      return { success: false, error: "완독 상태가 아닙니다." };
    }

    try {
      await createArticleRead.mutateAsync({
        data: { userId, articleId },
      });

      if (inboxIdRef.current) {
        try {
          await markInboxReadMutation.mutateAsync({ id: inboxIdRef.current });
        } catch {
        }
      }

      setSession((s) => ({ ...s, state: "COMPLETED_COMMITTED" as ReadingSessionState }));
      return { success: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "완독 기록에 실패했습니다.";
      return { success: false, error: msg };
    }
  }, [session.state, userId, articleId, createArticleRead, markInboxReadMutation]);

  const progress = getProgress(session.position.currentPage, session.position.totalPages);
  const canExit = !shouldBlockExit(mode, session.state);
  const showExitUI = shouldShowExitUI(mode);

  return {
    session,
    progress,
    canExit,
    showExitUI,
    nextPage,
    prevPage,
    onScroll,
    startReading,
    pause,
    resume,
    commitCompletion,
  };
}
