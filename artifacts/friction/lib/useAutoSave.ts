import { useRef, useState, useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

interface PendingPayload {
  title: string;
  content: string;
  entityId?: string;
  creationId?: string;
  aliasQueueKeys?: string[];
}

interface UseAutoSaveOptions {
  debounceMs?: number;
  maxRetries?: number;
  storageKey?: string;
  creationId?: string;
  onSave: (data: { title: string; content: string }) => Promise<void>;
  onRestore?: (data: {
    title: string;
    content: string;
    entityId?: string;
    creationId?: string;
  }) => void;
}

async function persistQueue(key: string, data: PendingPayload | null): Promise<void> {
  if (data) {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } else {
    await AsyncStorage.removeItem(key);
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
  creationId,
  onSave,
  onRestore,
}: UseAutoSaveOptions) {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);

  const latestDataRef = useRef<PendingPayload>({ title: "", content: "", creationId });
  if (creationId && !latestDataRef.current.creationId) {
    latestDataRef.current.creationId = creationId;
  }
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
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const queueKey = storageKey ? `autosave_queue_${storageKey}` : null;
  const queueKeysRef = useRef<Set<string>>(new Set());
  if (queueKey) queueKeysRef.current.add(queueKey);
  const queueWriteRef = useRef<Promise<void>>(Promise.resolve());

  // Tracks the currently in-flight save promise so flush() can await it
  // instead of starting a concurrent save that races with the existing one.
  const activeSaveRef = useRef<Promise<void> | null>(null);

  const clearRetryTimer = useCallback(() => {
    if (!retryTimerRef.current) return;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const writeQueue = useCallback((data: PendingPayload | null) => {
    const keys = Array.from(queueKeysRef.current);
    if (keys.length === 0) return Promise.resolve();
    // Preserve call order across AsyncStorage writes. A delayed dirty write
    // must never finish after a later successful remove and resurrect a stale
    // payload on the next mount.
    queueWriteRef.current = queueWriteRef.current.catch(() => undefined).then(async () => {
      const queued = data ? { ...data, aliasQueueKeys: keys } : null;
      await Promise.all(keys.map((key) => persistQueue(key, queued)));
    });
    return queueWriteRef.current;
  }, []);

  const bindEntity = useCallback(async (entityId: string, nextStorageKey: string) => {
    const nextQueueKey = `autosave_queue_${nextStorageKey}`;
    queueKeysRef.current.add(nextQueueKey);
    latestDataRef.current = { ...latestDataRef.current, entityId };
    // Write the recoverable server identity and newest payload under both the
    // local-draft key and the persisted-id key before the route changes. A
    // process death on either side can then resume with PATCH, never a second
    // create or a missing newer snapshot.
    await writeQueue({ ...latestDataRef.current });
  }, [writeQueue]);

  const doSave = useCallback(async () => {
    if (savingRef.current) return;

    const data = {
      title: latestDataRef.current.title,
      content: latestDataRef.current.content,
    };
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
      let saved = false;
      try {
        // A create idempotency key is useful only if it survives a process
        // death before the POST response. Never issue a server write until all
        // queue writes scheduled for this snapshot have completed durably.
        await queueWriteRef.current;
        await onSaveRef.current(data);
        saved = true;
        if (id >= latestCompletedRef.current) {
          latestCompletedRef.current = id;
          retryCountRef.current = 0;
          // Only mark clean if no new markDirty was called after this save started.
          if (requestIdRef.current === id && dirtyEpochRef.current === epochSnapshot) {
            clearRetryTimer();
            await writeQueue(null);
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
            // A newer payload is still pending. Its markDirty call already
            // placed the newest snapshot in storage, so do not clear it here.
          }
        }
      } catch {
        if (id >= latestCompletedRef.current) {
          // discard() may have intentionally cancelled this payload while the
          // request was in flight (for example, a formatting-only local
          // thought). Do not resurrect it as an error or retry.
          if (!isDirtyRef.current) return;

          // New input can arrive while this request is failing. Persist and
          // retry the newest payload, never the stale save-start snapshot.
          writeQueue({ ...latestDataRef.current });
          retryCountRef.current++;
          if (retryCountRef.current <= maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, retryCountRef.current - 1), 10000);
            clearRetryTimer();
            retryTimerRef.current = setTimeout(() => {
              retryTimerRef.current = null;
              void doSave();
            }, delay);
            return;
          }
          setStatus("error");
        }
      } finally {
        savingRef.current = false;
        if (activeSaveRef.current === p) activeSaveRef.current = null;
        // A change received during an in-flight save may already have spent
        // its debounce while savingRef was true. Schedule its next save here
        // so a local draft's first create cannot strand newer text in memory.
        if (saved && isDirtyRef.current && dirtyEpochRef.current !== epochSnapshot) {
          setTimeout(() => {
            if (isDirtyRef.current && !savingRef.current) {
              void doSave();
            }
          }, 0);
        }
      }
    };

    const p = run();
    activeSaveRef.current = p;
    await p;
  }, [clearRetryTimer, maxRetries, writeQueue]);

  useEffect(() => {
    if (!queueKey) return;
    let cancelled = false;
    loadQueue(queueKey).then((queued) => {
      if (cancelled || !queued) return;
      for (const alias of queued.aliasQueueKeys ?? []) {
        if (alias.startsWith("autosave_queue_")) queueKeysRef.current.add(alias);
      }
      // Queues from versions before create idempotency existed have no
      // creationId. Attach this screen's generated id (or the already-bound
      // entity id) and enqueue that upgraded payload before doSave can POST.
      const restored = {
        ...queued,
        creationId:
          queued.creationId ?? queued.entityId ?? latestDataRef.current.creationId,
      };
      latestDataRef.current = restored;
      dirtyEpochRef.current++;
      isDirtyRef.current = true;
      setIsDirty(true);
      // Restore the exact pending snapshot into the visible editor before
      // retrying it, so a remount cannot show a blank/server-old document while
      // silently saving different queued content.
      onRestoreRef.current?.(restored);
      writeQueue({ ...restored });
      doSave();
    });
    return () => { cancelled = true; };
  }, [queueKey, doSave]);

  const markDirty = useCallback(
    (title: string, content: string) => {
      latestDataRef.current = { ...latestDataRef.current, title, content };
      // Bump epoch BEFORE setting isDirtyRef so any in-flight doSave that
      // checks (dirtyEpochRef.current === epochSnapshot) sees the mismatch
      // and does not clear the dirty flag prematurely.
      dirtyEpochRef.current++;
      isDirtyRef.current = true;
      setIsDirty(true);
      writeQueue({ ...latestDataRef.current });

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        doSave();
      }, debounceMs);
    },
    [debounceMs, doSave, writeQueue],
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
      latestDataRef.current = { ...latestDataRef.current, title, content };
      // Bump epoch so any in-flight doSave does not clear isDirtyRef
      // if this title keystroke arrives during a concurrent save.
      dirtyEpochRef.current++;
      isDirtyRef.current = true;
      setIsDirty(true);
      writeQueue({ ...latestDataRef.current });

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        doSave();
      }, debounceMs);
    },
    [debounceMs, doSave, writeQueue],
  );

  const flush = useCallback(async (): Promise<{ ok: boolean }> => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    clearRetryTimer();

    // If a save is already in-flight, wait for it to complete rather than
    // force-resetting savingRef and launching a concurrent save. A concurrent
    // save can race: if the second save fails while the first already succeeded,
    // retryCountRef ends up > 0 and flush incorrectly returns { ok: false }
    // even though the data was persisted — causing a spurious "저장 실패" alert.
    const hadInFlight = !!activeSaveRef.current;
    if (activeSaveRef.current) {
      await activeSaveRef.current;
    }

    // The in-flight request may have scheduled a retry while flush() was
    // awaiting it. Cancel that timer before starting synchronous retries, or
    // it can reset the save guard and launch a concurrent stale request.
    clearRetryTimer();

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
      clearRetryTimer();

      if (attempt < FLUSH_MAX_ATTEMPTS - 1) {
        await new Promise<void>((resolve) => setTimeout(resolve, FLUSH_RETRY_DELAY_MS));
      }
    }

    return { ok: false };
  }, [clearRetryTimer, status, doSave]);

  const retry = useCallback(async () => {
    if (status !== "error") return;
    clearRetryTimer();
    retryCountRef.current = 0;
    savingRef.current = false;
    await doSave();
  }, [clearRetryTimer, status, doSave]);

  const discard = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    clearRetryTimer();
    // Invalidate any in-flight completion and make its failure a no-op.
    dirtyEpochRef.current++;
    retryCountRef.current = 0;
    const { creationId: stableCreationId, entityId: boundEntityId } = latestDataRef.current;
    latestDataRef.current = {
      title: "",
      content: "",
      creationId: stableCreationId,
      entityId: boundEntityId,
    };
    isDirtyRef.current = false;
    setIsDirty(false);
    setStatus("idle");
    try {
      await writeQueue(null);
    } catch {
      // A formatting-only draft remains intentionally unsaved. Queue cleanup
      // is best-effort here so storage failure is not mislabeled as loss of a
      // meaningful thought.
    }
  }, [clearRetryTimer, writeQueue]);

  useEffect(() => {
    return () => {
      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      clearRetryTimer();
    };
  }, [clearRetryTimer]);

  return { status, isDirty, markDirty, markTitleDirty, flush, retry, discard, bindEntity };
}
