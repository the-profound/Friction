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
  // Incremented by markDirty/markTitleDirty on every new dirty call.
  // doSave snapshots this at save-start; completion only clears isDirtyRef
  // if the epoch hasn't changed — i.e. no new markDirty was called while the
  // save was in-flight. This is the fix for the flush() early-return race:
  // flush() awaits an in-flight title save; that save must NOT clear isDirtyRef
  // if markDirty(body) was called after the save started.
  const dirtyEpochRef = useRef(0);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const savingRef = useRef(false);
  const retryCountRef = useRef(0);
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Tracks dirty state synchronously so flush() called immediately after
  // markDirty() can detect pending changes before the React state update
  // has been applied (state updates are batched and may be delayed).
  const isDirtyRef = useRef(false);
  const onSaveRef = useRef(onSave);
  onSaveRef.current = onSave;
  const queueKey = storageKey ? `autosave_queue_${storageKey}` : null;

  // Tracks the currently in-flight save promise so flush() can await it
  // instead of starting a concurrent save that races with the existing one.
  const activeSaveRef = useRef<Promise<void> | null>(null);

  const doSave = useCallback(async () => {
    if (savingRef.current) return;

    const data = { ...latestDataRef.current };
    const id = ++requestIdRef.current;
    // Snapshot the dirty epoch so we can detect if markDirty was called
    // AFTER this save started (while we were awaiting the network). If it
    // was, we must NOT clear isDirtyRef — that new dirty data still needs
    // to be saved. This fixes the flush() early-return race condition:
    // previously, if markDirty was called and then flush() awaited an
    // in-flight save, the completing save would reset isDirtyRef=false and
    // flush() would return early without persisting the latest content.
    const epochSnapshot = dirtyEpochRef.current;

    savingRef.current = true;
    setStatus("saving");
    console.log(
      "[useAutoSave doSave] id=%d epoch=%d contentLen=%d preview=%j",
      id,
      epochSnapshot,
      data.content.length,
      data.content.slice(0, 80),
    );

    const run = async () => {
      try {
        await onSaveRef.current(data);
        if (id >= latestCompletedRef.current) {
          latestCompletedRef.current = id;
          retryCountRef.current = 0;
          if (queueKey) persistQueue(queueKey, null);
          // Only mark clean if no new markDirty was called after this save started.
          if (requestIdRef.current === id && dirtyEpochRef.current === epochSnapshot) {
            isDirtyRef.current = false;
            setIsDirty(false);
            setStatus("saved");
            console.log("[useAutoSave doSave] id=%d epoch matched → dirty cleared ✓", id);
          } else {
            // A new markDirty was called during this save — dirty data still pending.
            console.log(
              "[useAutoSave doSave] id=%d epoch drifted (%d→%d) → dirty kept",
              id,
              epochSnapshot,
              dirtyEpochRef.current,
            );
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
        if (activeSaveRef.current === p) activeSaveRef.current = null;
      }
    };

    const p = run();
    activeSaveRef.current = p;
    await p;
  }, [maxRetries, queueKey]);

  useEffect(() => {
    if (!queueKey) return;
    let cancelled = false;
    loadQueue(queueKey).then((queued) => {
      if (cancelled || !queued) return;
      latestDataRef.current = queued;
      dirtyEpochRef.current++;
      isDirtyRef.current = true;
      setIsDirty(true);
      doSave();
    });
    return () => { cancelled = true; };
  }, [queueKey, doSave]);

  const markDirty = useCallback(
    (title: string, content: string) => {
      latestDataRef.current = { title, content };
      // Bump epoch BEFORE setting isDirtyRef so any in-flight doSave that
      // checks (dirtyEpochRef.current === epochSnapshot) sees the mismatch
      // and does not clear the dirty flag prematurely.
      dirtyEpochRef.current++;
      isDirtyRef.current = true;
      setIsDirty(true);

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        doSave();
      }, debounceMs);
    },
    [debounceMs, doSave],
  );

  // Title-only dirty path: avoids re-passing the full body string on each
  // title keystroke. The body content is preserved from prior markDirty calls.
  // `fallbackContent` is used as a seed when no body has been queued yet (e.g.
  // user only edited the title before any body autosave fired) — this prevents
  // wiping a previously loaded body to an empty string.
  const markTitleDirty = useCallback(
    (title: string, fallbackContent: string = "") => {
      const prevContent = latestDataRef.current.content;
      const content = prevContent !== "" ? prevContent : fallbackContent;
      latestDataRef.current = { title, content };
      // Bump epoch so any in-flight doSave does not clear isDirtyRef
      // if this title keystroke arrives during a concurrent save.
      dirtyEpochRef.current++;
      isDirtyRef.current = true;
      setIsDirty(true);

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        doSave();
      }, debounceMs);
    },
    [debounceMs, doSave],
  );

  const flush = useCallback(async (): Promise<{ ok: boolean }> => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current);
      retryTimerRef.current = null;
    }

    // If a save is already in-flight, wait for it to complete rather than
    // force-resetting savingRef and launching a concurrent save. A concurrent
    // save can race: if the second save fails while the first already succeeded,
    // retryCountRef ends up > 0 and flush incorrectly returns { ok: false }
    // even though the data was persisted — causing a spurious "저장 실패" alert.
    const hadInFlight = !!activeSaveRef.current;
    if (activeSaveRef.current) {
      await activeSaveRef.current;
    }

    // After awaiting any in-flight save, allow doSave to proceed.
    savingRef.current = false;

    console.log(
      "[useAutoSave flush] hadInFlight=%s isDirtyRef=%s status=%s epoch=%d",
      hadInFlight,
      isDirtyRef.current,
      status,
      dirtyEpochRef.current,
    );

    if (!isDirtyRef.current && status !== "error") {
      console.log("[useAutoSave flush] isDirty=false → skip save");
      return { ok: retryCountRef.current === 0 };
    }
    console.log("[useAutoSave flush] isDirty=true → proceeding to save");

    // Flush retries synchronously (up to FLUSH_MAX_ATTEMPTS) with a short
    // delay between attempts. This means a brief network blip (< ~2 s) won't
    // surface a "저장 실패" alert to the user — the background auto-retry
    // logic inside doSave already handles longer outages separately.
    const FLUSH_MAX_ATTEMPTS = 3;
    const FLUSH_RETRY_DELAY_MS = 600;

    for (let attempt = 0; attempt < FLUSH_MAX_ATTEMPTS; attempt++) {
      retryCountRef.current = 0;
      savingRef.current = false;
      await doSave();

      if (retryCountRef.current === 0) {
        return { ok: true };
      }

      // Cancel the background retry timer doSave scheduled — we'll retry
      // directly in the next loop iteration instead.
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current);
        retryTimerRef.current = null;
      }

      if (attempt < FLUSH_MAX_ATTEMPTS - 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, FLUSH_RETRY_DELAY_MS));
      }
    }

    return { ok: false };
  }, [status, doSave]);

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

  return { status, isDirty, markDirty, markTitleDirty, flush, retry };
}
