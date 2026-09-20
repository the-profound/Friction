import { useCallback, useRef, useState, useEffect, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { upsertReadingRecord, useCreateUserArticleRead, useMarkInboxRead, useGetReadingRecord, useDeleteReadingRecord, getGetReadingRecordQueryKey, getListInboxQueryKey } from "@workspace/api-client-react";
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
  getCompletionCommitDisposition,
  settleCompletionCommit,
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
  flushPosition: () => Promise<void>;
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
  const createArticleRead = useCreateUserArticleRead();
  const markInboxReadMutation = useMarkInboxRead();
  const deleteReading = useDeleteReadingRecord();
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestPositionRef = useRef({ currentPage: 0, scrollPosition: 0 });
  const lastPersistedPositionRef = useRef<string | null>(null);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  const saveGenerationRef = useRef(0);
  const saveRevisionRef = useRef(0);
  const hydratedRef = useRef(false);
  const inFlightSaveRef = useRef<{ key: string; promise: Promise<void> } | null>(null);
  const saveIdentityRef = useRef(sessionIdentity);
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
      latestPositionRef.current = { currentPage, scrollPosition };
      const generation = saveGenerationRef.current + 1;
      saveGenerationRef.current = generation;
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveTimerRef.current = setTimeout(() => {
        saveTimerRef.current = null;
        saveQueueRef.current = saveQueueRef.current.catch(() => undefined).then(async () => {
          if (generation !== saveGenerationRef.current) return;
          if (!hydratedRef.current) return;
          if (!saveBoundary.canDispatch(userId, articleId)) return;
          const saveKey = `${currentPage}\u0000${scrollPosition}`;
          if (lastPersistedPositionRef.current === saveKey) return;
          const saveRevision = Math.max(saveRevisionRef.current + 1, Date.now());
          saveRevisionRef.current = saveRevision;
          const request = upsertReadingRecord(
            { userId, articleId, currentPage, scrollPosition, saveRevision },
            { signal: saveBoundary.beginDispatch() },
          ).then(() => {
            lastPersistedPositionRef.current = saveKey;
          }).catch(() => undefined);
          inFlightSaveRef.current = { key: saveKey, promise: request };
          try {
            await request;
          } finally {
            if (inFlightSaveRef.current?.promise === request) {
              inFlightSaveRef.current = null;
            }
          }
        });
      }, POSITION_SAVE_DEBOUNCE_MS);
    },
    [userId, articleId, saveBoundary],
  );

  const flushPosition = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    if (!hydratedRef.current || !saveBoundary.canDispatch(userId, articleId)) return;
    const { currentPage, scrollPosition } = latestPositionRef.current;
    const saveKey = `${currentPage}\u0000${scrollPosition}`;
    if (lastPersistedPositionRef.current === saveKey) return;
    if (inFlightSaveRef.current?.key === saveKey) {
      return inFlightSaveRef.current.promise;
    }
    saveGenerationRef.current += 1;
    const latestSignal = saveBoundary.beginDispatch(true);
    const pending = (async () => {
      if (!saveBoundary.canDispatch(userId, articleId)) return;
      const saveRevision = Math.max(saveRevisionRef.current + 1, Date.now());
      saveRevisionRef.current = saveRevision;
      try {
        await upsertReadingRecord(
          { userId, articleId, currentPage, scrollPosition, saveRevision },
          { signal: latestSignal },
        );
        lastPersistedPositionRef.current = saveKey;
      } catch {
      }
    })();
    inFlightSaveRef.current = { key: saveKey, promise: pending };
    void pending.finally(() => {
      if (inFlightSaveRef.current?.promise === pending) {
        inFlightSaveRef.current = null;
      }
    });
    saveQueueRef.current = pending;
    return pending;
  }, [articleId, saveBoundary, userId]);

  useEffect(() => {
    latestPositionRef.current = {
      currentPage: session.position.currentPage,
      scrollPosition: session.position.scrollPosition,
    };
  }, [session.position.currentPage, session.position.scrollPosition]);

  useEffect(() => {
    if (saveIdentityRef.current === sessionIdentity) return;
    saveIdentityRef.current = sessionIdentity;
    saveGenerationRef.current += 1;
    latestPositionRef.current = { currentPage: 0, scrollPosition: 0 };
    lastPersistedPositionRef.current = null;
    inFlightSaveRef.current = null;
    saveRevisionRef.current = 0;
    saveQueueRef.current = Promise.resolve();
    hydratedRef.current = false;
  }, [sessionIdentity]);

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
    const disposition = getCompletionCommitDisposition(session.state);
    if (disposition === "already_committed") {
      return { success: true };
    }
    if (disposition === "invalid") {
      return { success: false, error: "완독 상태가 아닙니다." };
    }

    const inboxId = inboxIdRef.current;
    const inboxSnapshots = inboxId
      ? queryClient.getQueriesData({ queryKey: getListInboxQueryKey() })
      : [];

    if (inboxId) {
      // Navigation may happen before persistence settles. Reflect the read state
      // before the first await so the destination inbox never flashes stale data.
      patchInboxItemInCache(queryClient, inboxId, {
        isRead: true,
        openedAt: new Date().toISOString(),
      });
    }

    try {
      await createArticleRead.mutateAsync({
        data: { userId, articleId },
      });

      if (inboxId) {
        await markInboxReadMutation.mutateAsync({ id: inboxId });
      }

      if (teamCollectionIdRef.current) {
        invalidateTeamArticles(queryClient, teamCollectionIdRef.current);
      }

      setSession((s) => ({ ...s, state: settleCompletionCommit(s.state) }));
      return { success: true };
    } catch (e: unknown) {
      for (const [queryKey, snapshot] of inboxSnapshots) {
        queryClient.setQueryData(queryKey, snapshot);
      }
      const msg = e instanceof Error ? e.message : "완독 기록에 실패했습니다.";
      return { success: false, error: msg };
    }
  }, [session.state, userId, articleId, createArticleRead, markInboxReadMutation, queryClient]);

  const restartReading = useCallback(() => {
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

  useEffect(() => {
    hydratedRef.current = isSessionHydrated && isCurrentSession;
    if (savedRecord?.record?.saveRevision != null) {
      saveRevisionRef.current = Math.max(
        saveRevisionRef.current,
        savedRecord.record.saveRevision,
      );
    }
  }, [isCurrentSession, isSessionHydrated, savedRecord?.record?.saveRevision]);

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
    flushPosition,
  };
}
