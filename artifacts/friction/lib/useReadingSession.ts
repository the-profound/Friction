import { useCallback, useRef, useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpsertReadingRecord, useCreateUserArticleRead, useMarkInboxRead, useGetReadingRecord, useDeleteReadingRecord, getGetReadingRecordQueryKey } from "@workspace/api-client-react";
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
  inboxId?: string;
}

export interface ReadingSessionActions {
  session: ReadingSession;
  progress: number;
  canExit: boolean;
  showExitUI: boolean;
  isRestoring: boolean;
  isSessionHydrated: boolean;
  nextPage: () => void;
  prevPage: () => void;
  jumpToPage: (targetPage: number) => void;
  onScroll: (scrollPosition: number) => void;
  startReading: () => void;
  pause: () => void;
  resume: () => void;
  commitCompletion: () => Promise<{ success: boolean; error?: string }>;
  resetProgress: () => Promise<{ success: boolean; error?: string }>;
}

export function useReadingSession({
  articleId,
  mode,
  totalPages,
  userId,
  inboxId,
}: UseReadingSessionOptions): ReadingSessionActions {
  const { data: savedRecord, isLoading: isRestoring } = useGetReadingRecord(
    { userId, articleId },
  );

  const [session, setSession] = useState<ReadingSession>(() =>
    createInitialSession(articleId, mode, totalPages),
  );

  const [isSessionHydrated, setIsSessionHydrated] = useState(false);

  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || isRestoring) return;
    restoredRef.current = true;
    const record = savedRecord?.record;
    if (record) {
      const restoredPage = Math.max(0, record.currentPage ?? 0);
      setSession((prev) => ({
        ...prev,
        position: {
          ...prev.position,
          currentPage: restoredPage,
          scrollPosition: record.scrollPosition ?? 0,
        },
      }));
    }
    setIsSessionHydrated(true);
  }, [savedRecord, isRestoring]);

  useEffect(() => {
    if (totalPages <= 0) return;
    setSession((prev) => {
      if (prev.position.totalPages === totalPages) return prev;
      return {
        ...prev,
        position: { ...prev.position, totalPages },
      };
    });
  }, [totalPages]);

  const queryClient = useQueryClient();
  const upsertReading = useUpsertReadingRecord();
  const createArticleRead = useCreateUserArticleRead();
  const markInboxReadMutation = useMarkInboxRead();
  const deleteReading = useDeleteReadingRecord();
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
        return next;
      }
      if (isLastPage(prev.position.currentPage, prev.position.totalPages) && prev.state === "READING") {
        const completed = markCompletedReady(prev);
        if (completed) return completed;
      }
      return prev;
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

  const jumpToPage = useCallback((targetPage: number) => {
    setSession((prev) => {
      const clamped = Math.max(0, Math.min(targetPage, prev.position.totalPages - 1));
      if (clamped === prev.position.currentPage) return prev;
      const next: ReadingSession = {
        ...prev,
        position: { ...prev.position, currentPage: clamped, scrollPosition: 0 },
      };
      savePosition(clamped, 0);
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
        await markInboxReadMutation.mutateAsync({ id: inboxIdRef.current });
      }

      setSession((s) => ({ ...s, state: "COMPLETED_COMMITTED" as ReadingSessionState }));
      return { success: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "완독 기록에 실패했습니다.";
      return { success: false, error: msg };
    }
  }, [session.state, userId, articleId, createArticleRead, markInboxReadMutation]);

  const resetProgress = useCallback(async () => {
    const record = savedRecord?.record;
    if (!record) {
      return { success: false, error: "저장된 읽기 기록이 없습니다." };
    }
    try {
      await deleteReading.mutateAsync({ id: record.id });
      await queryClient.invalidateQueries({ queryKey: getGetReadingRecordQueryKey({ userId, articleId }) });
      setSession(createInitialSession(articleId, mode, totalPages));
      restoredRef.current = false;
      return { success: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "읽기 기록 삭제에 실패했습니다.";
      return { success: false, error: msg };
    }
  }, [savedRecord, articleId, mode, totalPages, userId, deleteReading, queryClient]);

  const progress = getProgress(session.position.currentPage, session.position.totalPages);
  const canExit = !shouldBlockExit(mode, session.state);
  const showExitUI = shouldShowExitUI(mode);

  return {
    session,
    progress,
    canExit,
    showExitUI,
    isRestoring,
    isSessionHydrated,
    nextPage,
    prevPage,
    jumpToPage,
    onScroll,
    startReading,
    pause,
    resume,
    commitCompletion,
    resetProgress,
  };
}
