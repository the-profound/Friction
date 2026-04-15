import { useState, useCallback, useRef, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetOrCreateReadingMemo,
  useUpdateArticle,
  useDeleteArticle,
  getGetOrCreateReadingMemoQueryKey,
} from "@workspace/api-client-react";

interface UseReadingMemoOptions {
  userId: string;
  sourceArticleId: string;
  enabled?: boolean;
}

interface UseReadingMemoReturn {
  memoArticleId: string | undefined;
  memoContent: string;
  isMemoLoading: boolean;
  isMemoError: boolean;
  updateMemoContent: (markdown: string) => void;
  flushSave: () => Promise<void>;
  cleanup: () => Promise<void>;
  saveState: "idle" | "saving" | "saved" | "error";
}

const AUTOSAVE_DEBOUNCE_MS = 1200;

export function useReadingMemo({
  userId,
  sourceArticleId,
  enabled = true,
}: UseReadingMemoOptions): UseReadingMemoReturn {
  const queryClient = useQueryClient();
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const pendingContentRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const latestContentRef = useRef<string>("");
  const cleanupCalledRef = useRef(false);
  const memoArticleIdRef = useRef<string | undefined>(undefined);

  const memoQuery = useGetOrCreateReadingMemo(
    { userId, sourceArticleId },
    {
      query: {
        queryKey: getGetOrCreateReadingMemoQueryKey({ userId, sourceArticleId }),
        enabled: enabled && !!userId && !!sourceArticleId,
      },
    },
  );

  const updateArticle = useUpdateArticle();
  const deleteArticle = useDeleteArticle();
  const memoArticleId = memoQuery.data?.id;

  const deleteArticleRef = useRef(deleteArticle);
  const updateArticleRef = useRef(updateArticle);
  useEffect(() => { deleteArticleRef.current = deleteArticle; }, [deleteArticle]);
  useEffect(() => { updateArticleRef.current = updateArticle; }, [updateArticle]);

  useEffect(() => {
    memoArticleIdRef.current = memoArticleId;
  }, [memoArticleId]);

  useEffect(() => {
    latestContentRef.current = memoQuery.data?.content ?? "";
  }, [memoQuery.data?.content]);

  const saveContent = useCallback(
    async (markdown: string) => {
      if (!memoArticleId) {
        pendingContentRef.current = markdown;
        return;
      }
      setSaveState("saving");
      try {
        await updateArticle.mutateAsync({
          id: memoArticleId,
          data: { content: markdown },
        });
        queryClient.invalidateQueries({
          queryKey: getGetOrCreateReadingMemoQueryKey({ userId, sourceArticleId }),
        });
        setSaveState("saved");
      } catch (err) {
        console.warn("[useReadingMemo] auto-save failed:", err);
        setSaveState("error");
      }
    },
    [memoArticleId, updateArticle, queryClient, userId, sourceArticleId],
  );

  useEffect(() => {
    if (memoArticleId && pendingContentRef.current !== null) {
      const buffered = pendingContentRef.current;
      pendingContentRef.current = null;
      saveContent(buffered);
    }
  }, [memoArticleId, saveContent]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (cleanupCalledRef.current) return;
      const id = memoArticleIdRef.current;
      if (!id) return;
      cleanupCalledRef.current = true;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      const content = latestContentRef.current;
      if (content.trim() === "") {
        deleteArticleRef.current.mutate({ id });
      } else if (pendingContentRef.current !== null) {
        const pending = pendingContentRef.current;
        pendingContentRef.current = null;
        updateArticleRef.current.mutate({ id, data: { content: pending } });
      }
    };
  }, []);

  const updateMemoContent = useCallback(
    (markdown: string) => {
      latestContentRef.current = markdown;
      pendingContentRef.current = markdown;
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
      setSaveState("saving");
      debounceTimerRef.current = setTimeout(() => {
        if (pendingContentRef.current !== null) {
          const content = pendingContentRef.current;
          pendingContentRef.current = null;
          saveContent(content);
        }
      }, AUTOSAVE_DEBOUNCE_MS);
    },
    [saveContent],
  );

  const flushSave = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (pendingContentRef.current !== null) {
      const content = pendingContentRef.current;
      pendingContentRef.current = null;
      await saveContent(content);
    }
  }, [saveContent]);

  const cleanup = useCallback(async () => {
    if (cleanupCalledRef.current) return;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    if (!memoArticleId) return;
    cleanupCalledRef.current = true;

    const currentContent = latestContentRef.current;
    if (currentContent.trim() === "") {
      pendingContentRef.current = null;
      try {
        await deleteArticle.mutateAsync({ id: memoArticleId });
        queryClient.invalidateQueries({
          queryKey: getGetOrCreateReadingMemoQueryKey({ userId, sourceArticleId }),
        });
      } catch (err) {
        console.warn("[useReadingMemo] cleanup delete failed:", err);
      }
    } else if (pendingContentRef.current !== null) {
      const content = pendingContentRef.current;
      pendingContentRef.current = null;
      await saveContent(content);
    }
  }, [memoArticleId, deleteArticle, queryClient, userId, sourceArticleId, saveContent]);

  return {
    memoArticleId,
    memoContent: memoQuery.data?.content ?? "",
    isMemoLoading: memoQuery.isLoading,
    isMemoError: memoQuery.isError,
    updateMemoContent,
    flushSave,
    cleanup,
    saveState,
  };
}
