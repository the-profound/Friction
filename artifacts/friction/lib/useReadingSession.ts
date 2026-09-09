import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useUpsertReadingRecord, useCreateUserArticleRead, useMarkInboxRead, useGetReadingRecord, useDeleteReadingRecord, getGetReadingRecordQueryKey } from "@workspace/api-client-react";
import { invalidateTeamArticles, patchInboxItemInCache } from "./queryInvalidation";
import type { ReadingMode } from "./policies";
import {
  createInitialSession,
  advancePage,
  goToPreviousPage,
  updateScrollPosition,
  markCompletedReady,
  canTransitionSession,
  transitionSession,
  isLastPage,
  getProgress,
  clampReadingPage,
  shouldBlockExit,
  shouldShowExitUI,
} from "./readingPersistence";
import type { ReadingSession, ReadingSessionState } from "./readingPersistence";
import { createReadingSaveBoundary } from "./readingSaveBoundary";

const POSITION_SAVE_DEBOUNCE_MS = 2000;

export interface UseReadingSessionOptions {
  articleId: string;
  mode: ReadingMode;
  totalPages: number;
  userId: string;
  inboxId?: string;
  teamCollectionId?: string;
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
  restartReading: () => void;
  continueReading: () => void;
  resetProgress: () => Promise<{ success: boolean; error?: string }>;
}

export function useReadingSession({
  articleId,
  mode,
  totalPages,
  userId,
  inboxId,
  teamCollectionId,
}: UseReadingSessionOptions): ReadingSessionActions {
  const { data: savedRecord, isLoading: isRestoring } = useGetReadingRecord(
    { userId, articleId },
  );

  const [session, setSession] = useState<ReadingSession>(() =>
    createInitialSession(articleId, mode, totalPages),
  );

  const [isSessionHydrated, setIsSessionHydrated] = useState(false);

  const restoredRef = useRef(false);
  const sessionIdentity = `${userId}\u0000${articleId}\u0000${mode}\u0000${inboxId ?? ""}`;
  const sessionIdentityRef = useRef(sessionIdentity);
  useEffect(() => {
    if (sessionIdentityRef.current === sessionIdentity) return;
    sessionIdentityRef.current = sessionIdentity;
    restoredRef.current = false;
    setIsSessionHydrated(false);
    setSession(createInitialSession(articleId, mode, totalPages));
  }, [articleId, mode, sessionIdentity, totalPages]);

  useEffect(() => {
    if (restoredRef.current || isRestoring) return;
    restoredRef.current = true;
    const record = savedRecord?.record;
    if (record && mode !== "re_read") {
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
  }, [savedRecord, isRestoring, mode]);

  useEffect(() => {
    if (totalPages <= 0) return;
    setSession((prev) => {
      if (prev.position.totalPages === totalPages) return prev;
      return {
        ...prev,
        position: {
          ...prev.position,
          currentPage: clampReadingPage(prev.position.currentPage, totalPages),
          totalPages,
        },
      };
    });
  }, [totalPages]);

  const queryClient = useQueryClient();
  const saveBoundary = useMemo(
    () => createReadingSaveBoundary(userId, articleId),
    [articleId, userId],
  );
  const upsertReading = useUpsertReadingRecord({
    request: { signal: saveBoundary.signal },
  });
  const createArticleRead = useCreateUserArticleRead();
  const markInboxReadMutation = useMarkInboxRead();
  const deleteReading = useDeleteReadingRecord();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inboxIdRef = useRef(inboxId);
  const teamCollectionIdRef = useRef(teamCollectionId);
  useEffect(() => {
    inboxIdRef.current = inboxId;
  }, [inboxId]);
  useEffect(() => { teamCollectionIdRef.current = teamCollectionId; }, [teamCollectionId]);

  // A protected navigation tree is replaced when the account changes. Do not
  // let a debounced write from the previous account survive that replacement.
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) {
        clearTimeout(saveTimerRef.current);
        saveTimerRef.current = null;
      }
      saveBoundary.dispose();
    };
  }, [saveBoundary]);

  const savePosition = useCallback(
    (currentPage: number, scrollPosition: number) => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(async () => {
        if (!saveBoundary.canDispatch(userId, articleId)) return;
        try {
          await upsertReading.mutateAsync({
            data: { userId, articleId, currentPage, scrollPosition },
          });
        } catch {
        }
      }, POSITION_SAVE_DEBOUNCE_MS);
    },
    [userId, articleId, saveBoundary, upsertReading],
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
        if (next.position.currentPage >= next.position.totalPages && prev.state === "READING") {
          const completed = markCompletedReady(next);
          if (completed) return completed;
        }
        savePosition(next.position.currentPage, 0);
        return next;
      }
      return prev;
    });
  }, [savePosition]);

  const prevPage = useCallback(() => {
    setSession((prev) => {
      if (prev.position.currentPage >= prev.position.totalPages && prev.state === "COMPLETED_READY") {
        const restored = {
          ...prev,
          state: "READING" as const,
          position: {
            ...prev.position,
            currentPage: prev.position.totalPages - 1,
            scrollPosition: 0,
          },
        };
        savePosition(restored.position.currentPage, 0);
        return restored;
      }
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
        const inboxId = inboxIdRef.current;
        // Optimistically mark this inbox row as read so the inbox list 화면
        // 으로 돌아갔을 때 다시 fetch 하느라 스피너가 뜨지 않는다.
        patchInboxItemInCache(queryClient, inboxId, {
          isRead: true,
          openedAt: new Date().toISOString(),
        });
        await markInboxReadMutation.mutateAsync({ id: inboxId });
      }

      if (teamCollectionIdRef.current) {
        invalidateTeamArticles(queryClient, teamCollectionIdRef.current);
      }

      setSession((s) => ({ ...s, state: "COMPLETED_COMMITTED" as ReadingSessionState }));
      return { success: true };
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : "완독 기록에 실패했습니다.";
      return { success: false, error: msg };
    }
  }, [session.state, userId, articleId, createArticleRead, markInboxReadMutation, queryClient]);

  const restartReading = useCallback(() => {
    if (session.state !== "COMPLETED_READY") return;
    const result = transitionSession(session.state, "READING");
    if (!result.allowed) return;
    setSession((prev) => ({
      ...prev,
      state: result.state,
      position: { ...prev.position, currentPage: 0, scrollPosition: 0 },
    }));
    savePosition(0, 0);
  }, [session.state, savePosition]);

  const continueReading = useCallback(() => {
    if (session.state !== "COMPLETED_READY") return;
    const result = transitionSession(session.state, "READING");
    if (!result.allowed) return;
    setSession((prev) => ({ ...prev, state: result.state }));
  }, [session.state]);

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
  const isCurrentSession =
    sessionIdentityRef.current === sessionIdentity &&
    session.articleId === articleId &&
    session.mode === mode;

  return {
    session,
    progress,
    canExit,
    showExitUI,
    isRestoring,
    isSessionHydrated: isSessionHydrated && isCurrentSession,
    nextPage,
    prevPage,
    jumpToPage,
    onScroll,
    startReading,
    pause,
    resume,
    commitCompletion,
    restartReading,
    continueReading,
    resetProgress,
  };
}
