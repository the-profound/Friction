import { useRef, useState, useCallback, useEffect } from "react";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

interface PendingChange {
  title: string;
  content: string;
  requestId: number;
}

interface UseAutoSaveOptions {
  debounceMs?: number;
  maxRetries?: number;
  onSave: (data: { title: string; content: string }) => Promise<void>;
}

export function useAutoSave({
  debounceMs = 1200,
  maxRetries = 3,
  onSave,
}: UseAutoSaveOptions) {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);

  const latestDataRef = useRef<{ title: string; content: string }>({ title: "", content: "" });
  const requestIdRef = useRef(0);
  const latestCompletedRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryQueueRef = useRef<PendingChange | null>(null);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;

  const doSave = useCallback(async () => {
    if (savingRef.current) return;

    const data = { ...latestDataRef.current };
    const id = ++requestIdRef.current;

    savingRef.current = true;
    setStatus("saving");

    try {
      await onSaveRef.current(data);
      if (id >= latestCompletedRef.current) {
        latestCompletedRef.current = id;
        retryCountRef.current = 0;
        retryQueueRef.current = null;
        if (requestIdRef.current === id) {
          setIsDirty(false);
          setStatus("saved");
        }
      }
    } catch {
      if (id >= latestCompletedRef.current) {
        retryCountRef.current++;
        if (retryCountRef.current <= (maxRetries)) {
          retryQueueRef.current = { ...data, requestId: id };
          const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 10000);
          retryTimerRef.current = setTimeout(() => {
            savingRef.current = false;
            doSave();
          }, delay);
          return;
        }
        setStatus("error");
      }
    } finally {
      savingRef.current = false;
    }
  }, [maxRetries]);

  const markDirty = useCallback(
    (title: string, content: string) => {
      latestDataRef.current = { title, content };
      setIsDirty(true);

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        doSave();
      }, debounceMs);
    },
    [debounceMs, doSave],
  );

  const flush = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }
    savingRef.current = false;
    if (isDirty || status === "error") {
      await doSave();
    }
  }, [isDirty, status, doSave]);

  const retry = useCallback(async () => {
    if (status !== "error") return;
    retryCountRef.current = 0;
    savingRef.current = false;
    await doSave();
  }, [status, doSave]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      if (retryTimerRef.current) clearTimeout(retryTimerRef.current);
    };
  }, []);

  return { status, isDirty, markDirty, flush, retry };
}
