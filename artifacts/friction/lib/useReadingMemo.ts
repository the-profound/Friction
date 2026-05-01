import { useState, useCallback, useRef, useEffect } from "react";
import {
  useCreateArticle,
  useUpdateArticle,
  useDeleteArticle,
} from "@workspace/api-client-react";

interface UseReadingMemoOptions {
  userId: string;
  sourceArticleId: string;
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

export function useReadingMemo({ userId, sourceArticleId }: UseReadingMemoOptions): UseReadingMemoReturn {
  const [saveState, setSaveState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [memoArticleId, setMemoArticleId] = useState<string | undefined>(undefined);
  const [memoContent, setMemoContent] = useState<string>("");

  const createArticle = useCreateArticle();
  const updateArticle = useUpdateArticle();
  const deleteArticle = useDeleteArticle();

  const latestContentRef = useRef<string>("");
  const pendingContentRef = useRef<string | null>(null);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cleanupCalledRef = useRef(false);
  const memoArticleIdRef = useRef<string | undefined>(undefined);
  const createPromiseRef = useRef<Promise<string | null> | null>(null);

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
    cleanupCalledRef.current = false;
    createPromiseRef.current = null;
    setMemoArticleId(undefined);
    setMemoContent("");
    setSaveState("idle");
  }, [userId, sourceArticleId]);

  const createDraftIfNeeded = useCallback(
    async (content: string): Promise<string | null> => {
      if (memoArticleIdRef.current) return memoArticleIdRef.current;
      if (createPromiseRef.current) return createPromiseRef.current;

      const promise = createArticleRef.current
        .mutateAsync({
          data: {
            authorId: userId,
            title: "읽기 메모",
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
    [userId, sourceArticleId],
  );

  const saveContent = useCallback(
    async (markdown: string) => {
      if (!markdown.trim()) {
        setSaveState("idle");
        return;
      }
      setSaveState("saving");
      try {
        let id = memoArticleIdRef.current;
        if (!id) {
          id = (await createDraftIfNeeded(markdown)) ?? undefined;
          if (!id) {
            setSaveState("error");
            return;
          }
          const latestAfterCreate = latestContentRef.current;
          if (latestAfterCreate.trim() && latestAfterCreate !== markdown) {
            await updateArticleRef.current.mutateAsync({ id, data: { content: latestAfterCreate } });
          }
          setSaveState("saved");
          return;
        }
        await updateArticleRef.current.mutateAsync({
          id,
          data: { content: markdown },
        });
        setSaveState("saved");
      } catch (err) {
        console.warn("[useReadingMemo] auto-save failed:", err);
        setSaveState("error");
      }
    },
    [createDraftIfNeeded],
  );

  const updateMemoContent = useCallback(
    (markdown: string) => {
      latestContentRef.current = markdown;
      pendingContentRef.current = markdown;
      setMemoContent(markdown);
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
    cleanupCalledRef.current = true;

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }

    const content = latestContentRef.current;
    const id = memoArticleIdRef.current;
    const pending = pendingContentRef.current;

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

    if (!id) {
      const contentToCreate = pending ?? content;
      try {
        const createdId = await createDraftIfNeeded(contentToCreate);
        if (createdId) {
          const latestAfterCreate = latestContentRef.current;
          if (latestAfterCreate.trim() && latestAfterCreate !== contentToCreate) {
            await updateArticleRef.current.mutateAsync({ id: createdId, data: { content: latestAfterCreate } });
          }
        }
      } catch (err) {
        console.warn("[useReadingMemo] cleanup create failed:", err);
      }
    } else if (pending !== null) {
      pendingContentRef.current = null;
      try {
        await updateArticleRef.current.mutateAsync({ id, data: { content: pending } });
      } catch (err) {
        console.warn("[useReadingMemo] cleanup save failed:", err);
      }
    }
  }, [createDraftIfNeeded]);

  const cleanupRef = useRef(cleanup);
  useEffect(() => { cleanupRef.current = cleanup; }, [cleanup]);

  useEffect(() => {
    return () => {
      void cleanupRef.current();
    };
  }, []);

  return {
    memoArticleId,
    memoContent,
    isMemoLoading: false,
    isMemoError: false,
    updateMemoContent,
    flushSave,
    cleanup,
    saveState,
  };
}
