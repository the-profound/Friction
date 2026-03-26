import { useRef, useState, useCallback, useEffect } from "react";

export type AutoSaveStatus = "saved" | "saving" | "error";

interface UseAutoSaveOptions {
  debounceMs?: number;
  onSave: (data: { title: string; content: string; requestId: number }) => Promise<void>;
}

export function useAutoSave({ debounceMs = 1200, onSave }: UseAutoSaveOptions) {
  const [status, setStatus] = useState<AutoSaveStatus>("saved");
  const [isDirty, setIsDirty] = useState(false);

  const latestDataRef = useRef<{ title: string; content: string }>({ title: "", content: "" });
  const requestIdRef = useRef(0);
  const latestCompletedRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);

  const doSave = useCallback(async () => {
    if (savingRef.current) return;
    if (!isDirty && status !== "error") return;

    const id = ++requestIdRef.current;
    const data = { ...latestDataRef.current, requestId: id };

    savingRef.current = true;
    setStatus("saving");

    try {
      await onSave(data);
      if (id >= latestCompletedRef.current) {
        latestCompletedRef.current = id;
        if (requestIdRef.current === id) {
          setIsDirty(false);
          setStatus("saved");
        }
      }
    } catch {
      if (id >= latestCompletedRef.current) {
        setStatus("error");
      }
    } finally {
      savingRef.current = false;
    }
  }, [isDirty, status, onSave]);

  const markDirty = useCallback(
    (title: string, content: string) => {
      latestDataRef.current = { title, content };
      setIsDirty(true);
      setStatus((prev) => (prev === "saved" ? "saved" : prev));

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
    if (isDirty || status === "error") {
      await doSave();
    }
  }, [isDirty, status, doSave]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
    };
  }, []);

  return { status, isDirty, markDirty, flush };
}
