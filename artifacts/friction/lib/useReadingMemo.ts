import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import {
  useCreateArticle,
  useUpdateArticle,
  useDeleteArticle,
  useGetReadingMemo,
  getReadingMemoQueryKey,
} from "@workspace/api-client-react";

interface UseReadingMemoOptions {
  userId: string;
  sourceArticleId: string;
  sourceArticleTitle?: string;
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
  cleanup: () => Promise<void>;
  saveState: "idle" | "saving" | "saved" | "error";
}

const AUTOSAVE_DEBOUNCE_MS = 1200;

function buildDefaultMemoTitle(sourceArticleTitle?: string): string {
  const trimmed = sourceArticleTitle?.trim();
  return trimmed ? `읽기 메모-${trimmed}` : "읽기 메모";
}

export function useReadingMemo({
  userId,
  sourceArticleId,
  sourceArticleTitle,
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

  const createArticle = useCreateArticle();
  const updateArticle = useUpdateArticle();
  const deleteArticle = useDeleteArticle();

  const memoQueryEnabled = !!userId && !!sourceArticleId;
  const memoQuery = useGetReadingMemo(
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
    setMemoArticleId(undefined);
    setMemoContent("");
    setMemoTitle("");
    setSaveState("idle");
  }, [userId, sourceArticleId]);

  // Hydrate from an existing source-linked memo (if any) on first successful
  // load. Once the user starts typing we won't overwrite their in-progress
  // edits.
  useEffect(() => {
    if (hydratedRef.current) return;
    if (!memoQuery.data) return;
    const existing = memoQuery.data;
    hydratedRef.current = true;
    memoArticleIdRef.current = existing.id;
    latestContentRef.current = existing.content ?? "";
    latestTitleRef.current = existing.title ?? "";
    setMemoArticleId(existing.id);
    setMemoContent(existing.content ?? "");
    setMemoTitle(existing.title ?? "");
  }, [memoQuery.data]);

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
            return;
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
          return;
        }
        await updateArticleRef.current.mutateAsync({
          id,
          data: { content: markdown, title: titleForSave },
        });
        setSaveState("saved");
      } catch (err) {
        console.warn("[useReadingMemo] auto-save failed:", err);
        setSaveState("error");
      }
    },
    [createDraftIfNeeded, resolveTitleForSave],
  );

  const runPersist = useCallback(
    (markdown: string, title: string): Promise<void> => {
      const prior = inFlightSaveRef.current;
      const next = (async () => {
        if (prior) {
          try { await prior; } catch { /* swallow; persistPending handles its own errors */ }
        }
        await persistPending(markdown, title);
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
      void runPersist(content, title);
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
      await runPersist(content, title);
    } else if (inFlightSaveRef.current) {
      try { await inFlightSaveRef.current; } catch { /* persistPending logs its own errors */ }
    }
  }, [runPersist]);

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
    cleanup,
    saveState,
  };
}
