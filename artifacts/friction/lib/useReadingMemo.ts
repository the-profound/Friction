import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { AppState, type AppStateStatus } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useQueryClient } from "@tanstack/react-query";
import {
  useCreateArticle,
  useUpdateArticle,
  useDeleteArticle,
  useReadingMemo as useReadingMemoQuery,
  getReadingMemoQueryKey,
} from "@workspace/api-client-react";
import { invalidateArticleLists } from "@/lib/queryInvalidation";

interface UseReadingMemoOptions {
  userId: string;
  sourceArticleId: string;
  sourceArticleTitle?: string;
  /**
   * Called when a background save (after auto retry) fails. Receives a
   * `retry` callback so the host can render an actionable toast/snackbar.
   */
  onSaveError?: (retry: () => void) => void;
  /**
   * Called once on hydrate when an unsent snapshot from a previous run is
   * recovered and queued for resend, so the host can notify the user.
   */
  onSnapshotRecovered?: () => void;
}

interface UseReadingMemoReturn {
  memoArticleId: string | undefined;
  memoContent: string;
  memoTitle: string;
  defaultMemoTitle: string;
  isMemoLoading: boolean;
  isMemoError: boolean;
  updateMemoContent: (markdown: string) => void;
  updateMemoTitle: (title: string) => void;
  flushSave: () => Promise<void>;
  /**
   * Fire-and-forget close path. Cancels the autosave debounce, persists the
   * latest known content in the background, and returns immediately so the
   * caller can dismiss UI without awaiting the network round-trip.
   */
  closeWithBackgroundSave: () => void;
  /** Manually retry the last failed save (e.g. from a toast action). */
  retryFailedSave: () => Promise<void>;
  cleanup: () => Promise<void>;
  saveState: "idle" | "saving" | "saved" | "error";
}

const AUTOSAVE_DEBOUNCE_MS = 1200;
const SNAPSHOT_KEY_PREFIX = "reading_memo_snapshot_";

interface SnapshotData {
  content: string;
  title: string;
  memoArticleId?: string;
  updatedAt: number;
}

function snapshotKey(userId: string, sourceArticleId: string): string {
  return `${SNAPSHOT_KEY_PREFIX}${userId}_${sourceArticleId}`;
}

async function writeSnapshot(key: string, data: SnapshotData | null): Promise<void> {
  try {
    if (data) {
      await AsyncStorage.setItem(key, JSON.stringify(data));
    } else {
      await AsyncStorage.removeItem(key);
    }
  } catch {
    /* non-fatal */
  }
}

async function readSnapshot(key: string): Promise<SnapshotData | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as SnapshotData) : null;
  } catch {
    return null;
  }
}

function buildDefaultMemoTitle(sourceArticleTitle?: string): string {
  const trimmed = sourceArticleTitle?.trim();
  return trimmed ? `읽기 메모-${trimmed}` : "읽기 메모";
}

export function useReadingMemo({
  userId,
  sourceArticleId,
  sourceArticleTitle,
  onSaveError,
  onSnapshotRecovered,
}: UseReadingMemoOptions): UseReadingMemoReturn {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [memoArticleId, setMemoArticleId] = useState<string | undefined>(undefined);
  const [memoContent, setMemoContent] = useState<string>("");
  const [memoTitle, setMemoTitle] = useState<string>("");

  const defaultMemoTitle = useMemo(
    () => buildDefaultMemoTitle(sourceArticleTitle),
    [sourceArticleTitle],
  );
  const defaultMemoTitleRef = useRef(defaultMemoTitle);
  useEffect(() => {
    defaultMemoTitleRef.current = defaultMemoTitle;
  }, [defaultMemoTitle]);

  const queryClient = useQueryClient();
  const queryClientRef = useRef(queryClient);
  useEffect(() => { queryClientRef.current = queryClient; }, [queryClient]);

  const createArticle = useCreateArticle();
  const updateArticle = useUpdateArticle();
  const deleteArticle = useDeleteArticle();

  const memoQueryEnabled = !!userId && !!sourceArticleId;
  const memoQuery = useReadingMemoQuery(
    { userId, sourceArticleId },
    {
      query: {
        queryKey: getReadingMemoQueryKey({ userId, sourceArticleId }),
        enabled: memoQueryEnabled,
        retry: (failureCount, error) => {
          const status = (error as { status?: number } | null)?.status;
          if (status === 404) return false;
          return failureCount < 2;
        },
      },
    },
  );

  const latestContentRef = useRef<string>("");
  const pendingContentRef = useRef<string | null>(null);
  const latestTitleRef = useRef<string>("");
  const pendingTitleRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupCalledRef = useRef(false);
  const memoArticleIdRef = useRef<string | undefined>(undefined);
  const createPromiseRef = useRef<Promise<string | null> | null>(null);
  const inFlightSaveRef = useRef<Promise<void> | null>(null);
  const hydratedRef = useRef(false);
  const snapshotKeyRef = useRef<string | null>(null);
  const onSaveErrorRef = useRef(onSaveError);
  useEffect(() => { onSaveErrorRef.current = onSaveError; }, [onSaveError]);
  const onSnapshotRecoveredRef = useRef(onSnapshotRecovered);
  useEffect(() => { onSnapshotRecoveredRef.current = onSnapshotRecovered; }, [onSnapshotRecovered]);

  const createArticleRef = useRef(createArticle);
  const updateArticleRef = useRef(updateArticle);
  const deleteArticleRef = useRef(deleteArticle);
  useEffect(() => { createArticleRef.current = createArticle; }, [createArticle]);
  useEffect(() => { updateArticleRef.current = updateArticle; }, [updateArticle]);
  useEffect(() => { deleteArticleRef.current = deleteArticle; }, [deleteArticle]);

  useEffect(() => {
    memoArticleIdRef.current = memoArticleId;
  }, [memoArticleId]);

  useEffect(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    memoArticleIdRef.current = undefined;
    latestContentRef.current = "";
    pendingContentRef.current = null;
    latestTitleRef.current = "";
    pendingTitleRef.current = null;
    cleanupCalledRef.current = false;
    createPromiseRef.current = null;
    inFlightSaveRef.current = null;
    hydratedRef.current = false;
    snapshotKeyRef.current = userId && sourceArticleId
      ? snapshotKey(userId, sourceArticleId)
      : null;
    setMemoArticleId(undefined);
    setMemoContent("");
    setMemoTitle("");
    setSaveState("idle");
  }, [userId, sourceArticleId]);

  // Hydrate from server (and any local snapshot of unsent edits) on first
  // successful load. Snapshot wins when it's newer or when server has nothing.
  useEffect(() => {
    if (hydratedRef.current) return;
    if (memoQuery.isLoading) return;
    // Wait for either a server result or a 404 (no existing memo).
    const status = (memoQuery.error as { status?: number } | null)?.status;
    if (memoQuery.isError && status !== 404) return;

    const existing = memoQuery.data;
    const sKey = snapshotKeyRef.current;
    let cancelled = false;

    (async () => {
      const snapshot = sKey ? await readSnapshot(sKey) : null;
      if (cancelled || hydratedRef.current) return;
      hydratedRef.current = true;

      if (existing) {
        memoArticleIdRef.current = existing.id;
        latestContentRef.current = existing.content ?? "";
        latestTitleRef.current = existing.title ?? "";
        setMemoArticleId(existing.id);
        setMemoContent(existing.content ?? "");
        setMemoTitle(existing.title ?? "");
      }

      // 미전송 스냅샷이 있으면 서버 데이터보다 우선 적용하고 자동 재전송하며,
      // 사용자에게도 복구되었음을 알려준다(onSnapshotRecovered).
      if (snapshot && snapshot.content) {
        const targetId = existing?.id ?? snapshot.memoArticleId;
        if (targetId) memoArticleIdRef.current = targetId;
        latestContentRef.current = snapshot.content;
        latestTitleRef.current = snapshot.title;
        pendingContentRef.current = snapshot.content;
        pendingTitleRef.current = snapshot.title;
        if (targetId) setMemoArticleId(targetId);
        setMemoContent(snapshot.content);
        setMemoTitle(snapshot.title);
        onSnapshotRecoveredRef.current?.();
        // Resend in background; clears snapshot on success.
        void runPersistRef.current?.(snapshot.content, snapshot.title)
          .catch(() => {
            onSaveErrorRef.current?.(() => { void runPersistRef.current?.(snapshot.content, snapshot.title); });
          });
      }
    })();

    return () => { cancelled = true; };
  }, [memoQuery.data, memoQuery.isLoading, memoQuery.isError, memoQuery.error]);

  const resolveTitleForSave = useCallback((rawTitle: string): string => {
    const trimmed = rawTitle.trim();
    return trimmed === "" ? defaultMemoTitleRef.current : rawTitle;
  }, []);

  const createDraftIfNeeded = useCallback(
    async (content: string, title: string): Promise<string | null> => {
      if (memoArticleIdRef.current) return memoArticleIdRef.current;
      if (createPromiseRef.current) return createPromiseRef.current;

      const promise = createArticleRef.current
        .mutateAsync({
          data: {
            authorId: userId,
            title: resolveTitleForSave(title),
            content,
            sourceArticleId,
          },
        })
        .then((article) => {
          const id = article.id;
          memoArticleIdRef.current = id;
          setMemoArticleId(id);
          createPromiseRef.current = null;
          // Invalidate the articles list so 기록 tab picks up the new memo.
          void invalidateArticleLists(queryClientRef.current);
          return id;
        })
        .catch((err) => {
          console.warn("[useReadingMemo] failed to create draft:", err);
          createPromiseRef.current = null;
          return null;
        });

      createPromiseRef.current = promise;
      return promise;
    },
    [userId, sourceArticleId, resolveTitleForSave],
  );

  const persistPending = useCallback(
    async (markdown: string, title: string) => {
      if (!markdown.trim()) {
        setSaveState("idle");
        return;
      }
      setSaveState("saving");
      try {
        const titleForSave = resolveTitleForSave(title);
        let id = memoArticleIdRef.current;
        if (!id) {
          id = (await createDraftIfNeeded(markdown, title)) ?? undefined;
          if (!id) {
            setSaveState("error");
            throw new Error("createDraftFailed");
          }
          const latestContent = latestContentRef.current;
          const latestTitle = latestTitleRef.current;
          const latestTitleForSave = resolveTitleForSave(latestTitle);
          const updates: { content?: string; title?: string } = {};
          if (latestContent.trim() && latestContent !== markdown) {
            updates.content = latestContent;
          }
          if (latestTitleForSave !== titleForSave) {
            updates.title = latestTitleForSave;
          }
          if (Object.keys(updates).length > 0) {
            await updateArticleRef.current.mutateAsync({ id, data: updates });
          }
          setSaveState("saved");
          // Successful save → snapshot is no longer needed.
          if (snapshotKeyRef.current) void writeSnapshot(snapshotKeyRef.current, null);
          return;
        }
        await updateArticleRef.current.mutateAsync({
          id,
          data: { content: markdown, title: titleForSave },
        });
        setSaveState("saved");
        if (snapshotKeyRef.current) void writeSnapshot(snapshotKeyRef.current, null);
      } catch (err) {
        console.warn("[useReadingMemo] auto-save failed:", err);
        setSaveState("error");
        throw err;
      }
    },
    [createDraftIfNeeded, resolveTitleForSave],
  );

  const lastFailedSaveRef = useRef<{ content: string; title: string } | null>(null);

  const runPersist = useCallback(
    (markdown: string, title: string): Promise<void> => {
      const prior = inFlightSaveRef.current;
      const next = (async () => {
        if (prior) {
          try { await prior; } catch { /* swallow; persistPending handles its own errors */ }
        }
        await persistPending(markdown, title);
        lastFailedSaveRef.current = null;
      })();
      inFlightSaveRef.current = next;
      void next.finally(() => {
        if (inFlightSaveRef.current === next) {
          inFlightSaveRef.current = null;
        }
      });
      return next;
    },
    [persistPending],
  );

  const runPersistRef = useRef(runPersist);
  useEffect(() => { runPersistRef.current = runPersist; }, [runPersist]);

  const scheduleAutoSave = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }
    setSaveState("saving");
    debounceTimerRef.current = setTimeout(() => {
      const content = pendingContentRef.current ?? latestContentRef.current;
      const title = pendingTitleRef.current ?? latestTitleRef.current;
      pendingContentRef.current = null;
      pendingTitleRef.current = null;
      void runPersist(content, title).catch(() => { /* surfaced via saveState */ });
    }, AUTOSAVE_DEBOUNCE_MS);
  }, [runPersist]);

  const updateMemoContent = useCallback(
    (markdown: string) => {
      hydratedRef.current = true;
      latestContentRef.current = markdown;
      pendingContentRef.current = markdown;
      setMemoContent(markdown);
      scheduleAutoSave();
    },
    [scheduleAutoSave],
  );

  const updateMemoTitle = useCallback(
    (title: string) => {
      hydratedRef.current = true;
      latestTitleRef.current = title;
      pendingTitleRef.current = title;
      setMemoTitle(title);
      scheduleAutoSave();
    },
    [scheduleAutoSave],
  );

  const flushSave = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingContentRef.current !== null || pendingTitleRef.current !== null) {
      const content = pendingContentRef.current ?? latestContentRef.current;
      const title = pendingTitleRef.current ?? latestTitleRef.current;
      pendingContentRef.current = null;
      pendingTitleRef.current = null;
      try {
        await runPersist(content, title);
      } catch { /* persistPending logs */ }
    } else if (inFlightSaveRef.current) {
      try { await inFlightSaveRef.current; } catch { /* persistPending logs */ }
    }
  }, [runPersist]);

  const retryFailedSave = useCallback(async () => {
    const failed = lastFailedSaveRef.current
      ?? { content: latestContentRef.current, title: latestTitleRef.current };
    if (!failed.content.trim()) return;
    try {
      await runPersist(failed.content, failed.title);
    } catch { /* surfaced via saveState */ }
  }, [runPersist]);

  const closeWithBackgroundSave = useCallback(() => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    const hasPending =
      pendingContentRef.current !== null || pendingTitleRef.current !== null;
    const content = pendingContentRef.current ?? latestContentRef.current;
    const title = pendingTitleRef.current ?? latestTitleRef.current;
    pendingContentRef.current = null;
    pendingTitleRef.current = null;

    if (!hasPending && !inFlightSaveRef.current) {
      // 입력 변경이 없었고 진행 중인 저장도 없으면 추가 작업 불필요.
      return;
    }
    if (!hasPending) {
      // 입력 변경 없음 + 저장 in-flight: 백그라운드 완료를 감시하다가
      // 실패하면 사용자에게 토스트로 알려 재시도 액션을 노출한다.
      const inflight = inFlightSaveRef.current;
      if (!inflight) return;
      void inflight.catch(() => {
        const recoverContent = latestContentRef.current;
        const recoverTitle = latestTitleRef.current;
        if (snapshotKeyRef.current && recoverContent.trim()) {
          void writeSnapshot(snapshotKeyRef.current, {
            content: recoverContent,
            title: recoverTitle,
            memoArticleId: memoArticleIdRef.current,
            updatedAt: Date.now(),
          });
        }
        lastFailedSaveRef.current = { content: recoverContent, title: recoverTitle };
        onSaveErrorRef.current?.(() => { void retryFailedSave(); });
      });
      return;
    }

    // 1차 시도. 실패 시 한 번 자동 재시도, 그래도 실패하면 onSaveError 콜백.
    void (async () => {
      try {
        await runPersist(content, title);
      } catch {
        // 마지막 본문은 스냅샷에도 보관해 앱 종료/재시작에도 살아남게 한다.
        if (snapshotKeyRef.current) {
          void writeSnapshot(snapshotKeyRef.current, {
            content,
            title,
            memoArticleId: memoArticleIdRef.current,
            updatedAt: Date.now(),
          });
        }
        lastFailedSaveRef.current = { content, title };
        try {
          await runPersist(content, title);
          lastFailedSaveRef.current = null;
        } catch {
          onSaveErrorRef.current?.(() => { void retryFailedSave(); });
        }
      }
    })();
  }, [runPersist, retryFailedSave]);

  // App backgrounding 가드 — 진행 중/예약된 저장이 있으면 마지막 본문을
  // AsyncStorage 스냅샷으로 남겨 다음 실행 때 자동 재전송한다.
  useEffect(() => {
    const handler = (state: AppStateStatus) => {
      if (state !== "background" && state !== "inactive") return;
      const sKey = snapshotKeyRef.current;
      if (!sKey) return;
      const dirty =
        pendingContentRef.current !== null ||
        pendingTitleRef.current !== null ||
        inFlightSaveRef.current !== null;
      if (!dirty) return;
      const content = pendingContentRef.current ?? latestContentRef.current;
      const title = pendingTitleRef.current ?? latestTitleRef.current;
      if (!content.trim()) return;
      void writeSnapshot(sKey, {
        content,
        title,
        memoArticleId: memoArticleIdRef.current,
        updatedAt: Date.now(),
      });
    };
    const sub = AppState.addEventListener("change", handler);
    return () => sub.remove();
  }, []);

  const cleanup = useCallback(async () => {
    if (cleanupCalledRef.current) return;
    cleanupCalledRef.current = true;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const content = latestContentRef.current;
    const title = latestTitleRef.current;
    const id = memoArticleIdRef.current;
    const pendingContent = pendingContentRef.current;
    const pendingTitle = pendingTitleRef.current;

    if (content.trim() === "") {
      if (id) {
        try {
          await deleteArticleRef.current.mutateAsync({ id });
        } catch (err) {
          console.warn("[useReadingMemo] cleanup delete failed:", err);
        }
      }
      if (snapshotKeyRef.current) void writeSnapshot(snapshotKeyRef.current, null);
      return;
    }

    const titleForSave = resolveTitleForSave(title);

    if (!id) {
      const contentToCreate = pendingContent ?? content;
      const titleToCreate = pendingTitle ?? title;
      try {
        const createdId = await createDraftIfNeeded(contentToCreate, titleToCreate);
        if (createdId) {
          const latestContent = latestContentRef.current;
          const latestTitle = latestTitleRef.current;
          const latestTitleForSave = resolveTitleForSave(latestTitle);
          const updates: { content?: string; title?: string } = {};
          if (latestContent.trim() && latestContent !== contentToCreate) {
            updates.content = latestContent;
          }
          if (latestTitleForSave !== resolveTitleForSave(titleToCreate)) {
            updates.title = latestTitleForSave;
          }
          if (Object.keys(updates).length > 0) {
            await updateArticleRef.current.mutateAsync({ id: createdId, data: updates });
          }
          if (snapshotKeyRef.current) void writeSnapshot(snapshotKeyRef.current, null);
        }
      } catch (err) {
        console.warn("[useReadingMemo] cleanup create failed:", err);
      }
    } else if (pendingContent !== null || pendingTitle !== null) {
      pendingContentRef.current = null;
      pendingTitleRef.current = null;
      const contentToSave = pendingContent ?? content;
      try {
        await updateArticleRef.current.mutateAsync({
          id,
          data: { content: contentToSave, title: titleForSave },
        });
        if (snapshotKeyRef.current) void writeSnapshot(snapshotKeyRef.current, null);
      } catch (err) {
        console.warn("[useReadingMemo] cleanup save failed:", err);
      }
    }
  }, [createDraftIfNeeded, resolveTitleForSave]);

  const cleanupRef = useRef(cleanup);
  useEffect(() => { cleanupRef.current = cleanup; }, [cleanup]);

  useEffect(() => {
    return () => {
      void cleanupRef.current();
    };
  }, []);

  const memoQueryError = memoQuery.error as { status?: number } | null | undefined;
  const isRealError = !!memoQueryError && memoQueryError.status !== 404;

  return {
    memoArticleId,
    memoContent,
    memoTitle,
    defaultMemoTitle,
    isMemoLoading: memoQueryEnabled && memoQuery.isLoading,
    isMemoError: isRealError,
    updateMemoContent,
    updateMemoTitle,
    flushSave,
    closeWithBackgroundSave,
    retryFailedSave,
    cleanup,
    saveState,
  };
}
