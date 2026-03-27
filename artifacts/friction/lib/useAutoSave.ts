import { useRef, useState, useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

interface PendingPayload {
  title: string;
  content: string;
}

interface UseAutoSaveOptions {
  debounceMs?: number;
  maxRetries?: number;
  storageKey?: string;
  onSave: (data: { title: string; content: string }) => Promise<void>;
}

async function persistQueue(key: string, data: PendingPayload | null): Promise<void> {
  try {
    if (data) {
      await AsyncStorage.setItem(key, JSON.stringify(data));
    } else {
      await AsyncStorage.removeItem(key);
    }
  } catch {
  }
}

async function loadQueue(key: string): Promise<PendingPayload | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as PendingPayload) : null;
  } catch {
    return null;
  }
}

export function useAutoSave({
  debounceMs = 1200,
  maxRetries = 3,
  storageKey,
  onSave,
}: UseAutoSaveOptions) {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);

  const latestDataRef = useRef<PendingPayload>({ title: "", content: "" });
  const requestIdRef = useRef(0);
  const latestCompletedRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const queueKey = storageKey ? `autosave_queue_${storageKey}` : null;

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
        if (queueKey) persistQueue(queueKey, null);
        if (requestIdRef.current === id) {
          setIsDirty(false);
          setStatus("saved");
        }
      }
    } catch {
      if (id >= latestCompletedRef.current) {
        if (queueKey) persistQueue(queueKey, data);
        retryCountRef.current++;
        if (retryCountRef.current <= maxRetries) {
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
  }, [maxRetries, queueKey]);

  useEffect(() => {
    if (!queueKey) return;
    let cancelled = false;
    loadQueue(queueKey).then((queued) => {
      if (cancelled || !queued) return;
      latestDataRef.current = queued;
      setIsDirty(true);
      doSave();
    });
    return () => { cancelled = true; };
  }, [queueKey, doSave]);

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
