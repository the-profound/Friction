import { useRef, useState, useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ThoughtDocumentSnapshot } from "@workspace/api-zod";
import { LatestSnapshotQueue } from "./latestSnapshotQueue";
import { updateEditorMemoryDiagnostic } from "./editorMemoryDiagnostics";

export type AutoSaveStatus = "idle" | "saving" | "saved" | "error";

export type AutoSaveEntityMode = "draft" | "dividing";

export interface PendingPayload {
  title: string;
  content: string;
  documentSnapshot?: ThoughtDocumentSnapshot;
  operation?: "save" | "delete";
  cleanupId?: string;
  entityId?: string;
  creationId?: string;
  creationGeneration?: number;
  aliasQueueKeys?: string[];
  entityMode?: AutoSaveEntityMode;
  serverUpdatedAt?: string;
  serverContentHash?: string;
  serverContentBaseline?: string;
  localChangedAt?: number;
  localGeneration?: number;
}

export interface AutoSaveRestoreContext {
  ready: boolean;
  entityId: string;
  entityMode: AutoSaveEntityMode;
  serverUpdatedAt: string;
  serverContent: string;
}

export interface AutoSaveTransitionSnapshot {
  title: string;
  content: string;
  documentSnapshot?: ThoughtDocumentSnapshot;
  serverUpdatedAt?: string;
  serverContent?: string;
}

export interface AutoSaveTransitionCommit {
  entityId: string;
  storageKey: string;
  entityMode: AutoSaveEntityMode;
  title: string;
  content: string;
  documentSnapshot?: ThoughtDocumentSnapshot;
  serverUpdatedAt: string;
  serverContent: string;
}

export type AutoSaveRestoreDecision = "restore" | "defer" | "conflict";

export function hashAutoSaveContent(content: string): string {
  let hash = 2166136261;
  for (let index = 0; index < content.length; index += 1) {
    hash ^= content.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function decideAutoSaveRestore(
  queued: PendingPayload,
  context?: AutoSaveRestoreContext,
): AutoSaveRestoreDecision {
  if (!context) return "restore";
  if (!context.ready) return "defer";
  if (
    queued.entityId !== context.entityId
    || queued.entityMode !== context.entityMode
    || !queued.serverUpdatedAt
    || !queued.serverContentHash
    || !queued.localChangedAt
    || !queued.localGeneration
  ) {
    return "conflict";
  }
  if (
    queued.serverUpdatedAt !== context.serverUpdatedAt
    || queued.serverContentHash !== hashAutoSaveContent(context.serverContent)
  ) {
    return "conflict";
  }
  if (
    context.entityMode === "dividing"
    && queued.serverContentBaseline !== context.serverContent
  ) {
    return "conflict";
  }
  if (queued.content.trim() === "") {
    return "conflict";
  }
  return "restore";
}

interface UseAutoSaveOptions {
  debounceMs?: number;
  maxRetries?: number;
  saveTimeoutMs?: number;
  storageTimeoutMs?: number;
  storageKey?: string;
  creationId?: string;
  creationGeneration?: number;
  entityId?: string;
  entityMode?: AutoSaveEntityMode;
  restoreContext?: AutoSaveRestoreContext;
  onSave: (data: {
    title: string;
    content: string;
    expectedServerContent?: string;
    creationGeneration?: number;
  }) => Promise<
    | {
        serverUpdatedAt?: string;
        serverContent?: string;
      }
    | void
  >;
  isRetryableError?: (error: unknown) => boolean;
  onCleanup?: (entityId: string) => Promise<void>;
  onRestore?: (data: {
    title: string;
    content: string;
    entityId?: string;
    creationId?: string;
    creationGeneration?: number;
  }) => void;
  onRestoreConflict?: () => void;
}

async function persistQueue(key: string, data: PendingPayload | null): Promise<void> {
  if (data) {
    await AsyncStorage.setItem(key, JSON.stringify(data));
  } else {
    await AsyncStorage.removeItem(key);
  }
}

type QueueWrite = {
  keys: string[];
  data: PendingPayload | null;
};

function rejectAfter<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  if (timeoutMs <= 0) return promise;
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label} timed out after ${timeoutMs}ms`)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
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
  saveTimeoutMs = 10_000,
  storageTimeoutMs = 3_000,
  storageKey,
  creationId,
  creationGeneration,
  entityId,
  entityMode,
  restoreContext,
  onSave,
  isRetryableError,
  onCleanup,
  onRestore,
  onRestoreConflict,
}: UseAutoSaveOptions) {
  const [status, setStatus] = useState<AutoSaveStatus>("idle");
  const [isDirty, setIsDirty] = useState(false);

  const latestDataRef = useRef<PendingPayload>({
    title: "",
    content: "",
    creationId,
    creationGeneration,
    entityId,
    entityMode,
  });
  const committedTransitionRef = useRef<{
    entityId: string;
    entityMode: AutoSaveEntityMode;
  } | null>(null);
  if (
    committedTransitionRef.current
    && committedTransitionRef.current.entityId === entityId
    && committedTransitionRef.current.entityMode === entityMode
  ) {
    committedTransitionRef.current = null;
  }
  if (creationId && !latestDataRef.current.creationId) {
    latestDataRef.current.creationId = creationId;
  }
  if (
    creationGeneration
    && !latestDataRef.current.creationGeneration
  ) {
    latestDataRef.current.creationGeneration = creationGeneration;
  }
  if (!committedTransitionRef.current) {
    if (entityId) latestDataRef.current.entityId = entityId;
    if (entityMode) latestDataRef.current.entityMode = entityMode;
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
  const isRetryableErrorRef = useRef(isRetryableError);
  isRetryableErrorRef.current = isRetryableError;
  const onCleanupRef = useRef(onCleanup);
  onCleanupRef.current = onCleanup;
  const onRestoreRef = useRef(onRestore);
  onRestoreRef.current = onRestore;
  const onRestoreConflictRef = useRef(onRestoreConflict);
  onRestoreConflictRef.current = onRestoreConflict;
  const restoreContextRef = useRef(restoreContext);
  restoreContextRef.current = restoreContext;
  const acknowledgedServerRef = useRef<AutoSaveRestoreContext | undefined>(
    restoreContext?.ready ? restoreContext : undefined,
  );
  if (
    restoreContext?.ready
    && (
      !committedTransitionRef.current
      || committedTransitionRef.current.entityId !== restoreContext.entityId
      || committedTransitionRef.current.entityMode !== restoreContext.entityMode
    )
    && (
      acknowledgedServerRef.current?.entityId !== restoreContext.entityId
      || (!isDirtyRef.current && !savingRef.current)
    )
  ) {
    acknowledgedServerRef.current = restoreContext;
  }
  const localGenerationRef = useRef(0);
  const queueKey = storageKey ? `autosave_queue_${storageKey}` : null;
  const queueKeysRef = useRef<Set<string>>(new Set());
  if (queueKey) queueKeysRef.current.add(queueKey);
  const queueWriterRef = useRef<LatestSnapshotQueue<QueueWrite> | null>(null);
  if (!queueWriterRef.current) {
    queueWriterRef.current = new LatestSnapshotQueue(
      async ({ keys, data }) => {
        const queued = data ? { ...data, aliasQueueKeys: keys } : null;
        await Promise.all(keys.map((key) => persistQueue(key, queued)));
      },
      (stats) => {
        updateEditorMemoryDiagnostic({
          operation: "autosave",
          lifecycle: "active",
          pendingOperations:
            (stats.active ? 1 : 0)
            + (stats.pendingLatest ? 1 : 0)
            + stats.barriers,
          payloadChars:
            latestDataRef.current.title.length
            + latestDataRef.current.content.length,
        });
      },
      () => setStatus("error"),
    );
  }
  const restoreAttemptedQueueKeyRef = useRef<string | null>(null);

  // Tracks the currently in-flight save promise so flush() can await it
  // instead of starting a concurrent save that races with the existing one.
  const activeSaveRef = useRef<Promise<void> | null>(null);
  const activeCleanupRef = useRef<Promise<{ ok: boolean }> | null>(null);
  // A stage transition owns the save lane while it snapshots and changes the
  // server entity. Debounced saves and the follow-up save scheduled after an
  // in-flight request must not overtake the atomic transition.
  const transitionLockRef = useRef(false);

  const nextRecoveryMetadata = useCallback((): Partial<PendingPayload> => {
    const context = acknowledgedServerRef.current ?? restoreContextRef.current;
    localGenerationRef.current += 1;
    return {
      ...(context
        ? {
            entityId: context.entityId,
            entityMode: context.entityMode,
            serverUpdatedAt: context.serverUpdatedAt,
            serverContentHash: hashAutoSaveContent(context.serverContent),
            serverContentBaseline: context.serverContent,
          }
        : {}),
      localChangedAt: Date.now(),
      localGeneration: localGenerationRef.current,
    };
  }, []);

  const clearRetryTimer = useCallback(() => {
    if (!retryTimerRef.current) return;
    clearTimeout(retryTimerRef.current);
    retryTimerRef.current = null;
  }, []);

  const writeQueue = useCallback((data: PendingPayload | null) => {
    const keys = Array.from(queueKeysRef.current);
    if (keys.length === 0) return Promise.resolve();
    return rejectAfter(
      queueWriterRef.current!.enqueueBarrier({ keys, data }),
      storageTimeoutMs,
      "autosave queue write",
    );
  }, [storageTimeoutMs]);

  const writeLatestQueue = useCallback((data: PendingPayload) => {
    const keys = Array.from(queueKeysRef.current);
    if (keys.length === 0) return;
    queueWriterRef.current!.enqueueLatest({ keys, data });
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
    if (savingRef.current || transitionLockRef.current) return;

    const data = {
      title: latestDataRef.current.title,
      content: latestDataRef.current.content,
      expectedServerContent: latestDataRef.current.serverContentBaseline,
      creationGeneration: latestDataRef.current.creationGeneration,
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
      "[useAutoSave doSave] id=%d epoch=%d contentLen=%d",
      id,
      epochSnapshot,
      data.content.length,
    );

    const run = async () => {
      let saved = false;
      let savedBaseline:
        | {
            serverUpdatedAt?: string;
            serverContent?: string;
          }
        | void;
      let watchdog: ReturnType<typeof setTimeout> | null = null;
      try {
        // A create idempotency key is useful only if it survives a process
        // death before the POST response. Never issue a server write until all
        // queue writes scheduled for this snapshot have completed durably.
        await rejectAfter(
          queueWriterRef.current!.whenIdle(),
          storageTimeoutMs,
          "autosave queue barrier",
        );
        const networkSave = onSaveRef.current(data);
        watchdog = setTimeout(() => {
          // Do not abandon the physical request or start a newer one. The
          // request may still reach the server, and allowing an overlapping
          // retry could let the older payload arrive last and overwrite it.
          if (activeSaveRef.current === p && isDirtyRef.current) {
            setStatus("error");
          }
        }, saveTimeoutMs);
        savedBaseline = await networkSave;
        if (savedBaseline?.serverContent !== undefined) {
          acknowledgedServerRef.current = {
            ready: true,
            entityId: latestDataRef.current.entityId ?? restoreContextRef.current?.entityId ?? "",
            entityMode:
              latestDataRef.current.entityMode
              ?? restoreContextRef.current?.entityMode
              ?? "draft",
            serverUpdatedAt:
              savedBaseline.serverUpdatedAt
              ?? restoreContextRef.current?.serverUpdatedAt
              ?? "",
            serverContent: savedBaseline.serverContent,
          };
        }
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
            if (savedBaseline?.serverContent !== undefined) {
              latestDataRef.current = {
                ...latestDataRef.current,
                serverUpdatedAt: savedBaseline.serverUpdatedAt,
                serverContentHash: hashAutoSaveContent(savedBaseline.serverContent),
                serverContentBaseline: savedBaseline.serverContent,
              };
              await writeQueue({ ...latestDataRef.current });
            }
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
      } catch (error) {
        if (id >= latestCompletedRef.current) {
          // discard() may have intentionally cancelled this payload while the
          // request was in flight (for example, a formatting-only local
          // thought). Do not resurrect it as an error or retry.
          if (!isDirtyRef.current) return;

          // New input can arrive while this request is failing. Persist and
          // retry the newest payload, never the stale save-start snapshot.
          if (
            latestDataRef.current.creationId
            && !latestDataRef.current.entityId
          ) {
            latestDataRef.current.creationGeneration =
              (latestDataRef.current.creationGeneration ?? 1) + 1;
          }
          writeLatestQueue(latestDataRef.current);
          if (isRetryableErrorRef.current?.(error) === false) {
            setStatus("error");
            return;
          }
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
        if (watchdog) clearTimeout(watchdog);
        savingRef.current = false;
        if (activeSaveRef.current === p) activeSaveRef.current = null;
        // A change received during an in-flight save may already have spent
        // its debounce while savingRef was true. Schedule its next save here
        // so a local draft's first create cannot strand newer text in memory.
        if (
          saved
          && !transitionLockRef.current
          && isDirtyRef.current
          && dirtyEpochRef.current !== epochSnapshot
        ) {
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
  }, [clearRetryTimer, maxRetries, saveTimeoutMs, storageTimeoutMs, writeQueue, writeLatestQueue]);

  const runPendingCleanup = useCallback((entityId?: string): Promise<{ ok: boolean }> => {
    if (activeCleanupRef.current) return activeCleanupRef.current;
    // Direct-thought POST uses the durable creationId as the record id. If the
    // process dies after POST commit but before its response binds entityId,
    // the tombstone can still delete that definitive server record on restore.
    const resolvedEntityId = entityId
      ?? latestDataRef.current.entityId
      ?? (latestDataRef.current.operation === "delete"
        ? latestDataRef.current.creationId
        : undefined);
    if (!resolvedEntityId || !onCleanupRef.current) return Promise.resolve({ ok: false });

    latestDataRef.current = {
      ...latestDataRef.current,
      operation: "delete",
      entityId: resolvedEntityId,
      cleanupId: latestDataRef.current.cleanupId ?? `delete:${resolvedEntityId}`,
    };
    const cleanupId = latestDataRef.current.cleanupId;
    const run = async (): Promise<{ ok: boolean }> => {
      try {
        await writeQueue({ ...latestDataRef.current });
        for (let attempt = 0; attempt < maxRetries; attempt += 1) {
          try {
            await rejectAfter(
              onCleanupRef.current!(resolvedEntityId),
              saveTimeoutMs,
              "autosave cleanup",
            );
            // A user may start a new direct draft while this restored DELETE
            // is in flight. Clear only the tombstone generation we started;
            // never erase a newer save snapshot in the shared queue.
            if (
              latestDataRef.current.operation === "delete"
              && latestDataRef.current.cleanupId === cleanupId
            ) {
              await writeQueue(null);
            }
            return { ok: true };
          } catch {
            if (attempt < maxRetries - 1) {
              await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
            }
          }
        }
        setStatus("error");
        return { ok: false };
      } finally {
        activeCleanupRef.current = null;
      }
    };
    const promise = run();
    activeCleanupRef.current = promise;
    return promise;
  }, [maxRetries, saveTimeoutMs, writeQueue]);

  useEffect(() => {
    if (!queueKey) return;
    if (restoreContext && !restoreContext.ready) return;
    if (restoreAttemptedQueueKeyRef.current === queueKey) return;
    restoreAttemptedQueueKeyRef.current = queueKey;
    let cancelled = false;
    const restoreStartEpoch = dirtyEpochRef.current;
    loadQueue(queueKey).then((queued) => {
      if (cancelled || !queued) return;
      // A local edit made while AsyncStorage was reading is newer than the
      // queued snapshot. Never replace visible text or latestData with the
      // delayed restore; markDirty has already queued the fresh snapshot.
      if (dirtyEpochRef.current !== restoreStartEpoch || isDirtyRef.current) return;
      const restoreDecision = decideAutoSaveRestore(queued, restoreContextRef.current);
      if (restoreDecision === "defer") return;
      if (restoreDecision === "conflict") {
        setStatus("error");
        onRestoreConflictRef.current?.();
        return;
      }
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
        creationGeneration:
          queued.creationGeneration
          ?? latestDataRef.current.creationGeneration
          ?? 1,
      };
      localGenerationRef.current = Math.max(
        localGenerationRef.current,
        restored.localGeneration ?? 0,
      );
      latestDataRef.current = restored;
      if (restored.operation === "delete") {
        void runPendingCleanup(restored.entityId);
        return;
      }
      dirtyEpochRef.current++;
      isDirtyRef.current = true;
      setIsDirty(true);
      // Restore the exact pending snapshot into the visible editor before
      // retrying it, so a remount cannot show a blank/server-old document while
      // silently saving different queued content.
      onRestoreRef.current?.(restored);
      void writeQueue({ ...restored }).catch(() => {
        if (!cancelled) setStatus("error");
      });
      doSave();
    });
    return () => { cancelled = true; };
  }, [
    queueKey,
    doSave,
    restoreContext?.ready,
    restoreContext?.entityId,
    restoreContext?.entityMode,
    restoreContext?.serverUpdatedAt,
    restoreContext?.serverContent,
    runPendingCleanup,
  ]);

  const markDirty = useCallback(
    (title: string, content: string, documentSnapshot?: ThoughtDocumentSnapshot) => {
      latestDataRef.current = {
        ...latestDataRef.current,
        title,
        content,
        documentSnapshot,
        operation: "save",
        cleanupId: undefined,
        ...nextRecoveryMetadata(),
      };
      // Bump epoch BEFORE setting isDirtyRef so any in-flight doSave that
      // checks (dirtyEpochRef.current === epochSnapshot) sees the mismatch
      // and does not clear the dirty flag prematurely.
      dirtyEpochRef.current++;
      isDirtyRef.current = true;
      setIsDirty(true);
      writeLatestQueue(latestDataRef.current);

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        doSave();
      }, debounceMs);
    },
    [debounceMs, doSave, nextRecoveryMetadata, writeLatestQueue],
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
      latestDataRef.current = {
        ...latestDataRef.current,
        title,
        content,
        operation: "save",
        cleanupId: undefined,
        ...nextRecoveryMetadata(),
      };
      // Bump epoch so any in-flight doSave does not clear isDirtyRef
      // if this title keystroke arrives during a concurrent save.
      dirtyEpochRef.current++;
      isDirtyRef.current = true;
      setIsDirty(true);
      writeLatestQueue(latestDataRef.current);

      if (debounceTimerRef.current) clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = setTimeout(() => {
        doSave();
      }, debounceMs);
    },
    [debounceMs, doSave, nextRecoveryMetadata, writeLatestQueue],
  );

  const persistLatest = useCallback(async () => {
    await writeQueue({ ...latestDataRef.current });
  }, [writeQueue]);

  const prepareTransition = useCallback(async (
    snapshot: AutoSaveTransitionSnapshot,
  ): Promise<{ ok: true; expectedServerUpdatedAt: string } | { ok: false }> => {
    transitionLockRef.current = true;
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    clearRetryTimer();

    // A save that already reached the server is allowed to finish, but no new
    // PATCH is started for this transition. This keeps the server version used
    // by the atomic request after the last in-flight autosave.
    if (activeSaveRef.current) {
      try {
        await rejectAfter(activeSaveRef.current, saveTimeoutMs, "active transition save");
      } catch {
        transitionLockRef.current = false;
        return { ok: false };
      }
    }
    clearRetryTimer();

    const serverContext = acknowledgedServerRef.current ?? restoreContextRef.current;
    const expectedServerUpdatedAt =
      serverContext?.serverUpdatedAt ?? snapshot.serverUpdatedAt ?? "";
    if (!expectedServerUpdatedAt) {
      transitionLockRef.current = false;
      return { ok: false };
    }

    localGenerationRef.current += 1;
    latestDataRef.current = {
      ...latestDataRef.current,
      title: snapshot.title,
      content: snapshot.content,
      documentSnapshot: snapshot.documentSnapshot,
      operation: "save",
      cleanupId: undefined,
      serverUpdatedAt: expectedServerUpdatedAt,
      serverContentHash: hashAutoSaveContent(
        serverContext?.serverContent ?? snapshot.serverContent ?? "",
      ),
      serverContentBaseline: serverContext?.serverContent ?? snapshot.serverContent,
      localChangedAt: Date.now(),
      localGeneration: localGenerationRef.current,
    };
    isDirtyRef.current = true;
    setIsDirty(true);
    try {
      await writeQueue({ ...latestDataRef.current });
    } catch {
      transitionLockRef.current = false;
      return { ok: false };
    }
    return { ok: true, expectedServerUpdatedAt };
  }, [clearRetryTimer, saveTimeoutMs, writeQueue]);

  const abortTransition = useCallback(() => {
    transitionLockRef.current = false;
  }, []);

  const commitTransition = useCallback(async (commit: AutoSaveTransitionCommit) => {
    // The old entity's recovery queue is no longer valid after the atomic
    // transition. Serialize its removal before binding the destination key.
    // Do not report the transition as locally committed if this durability
    // barrier times out or fails. Otherwise a process death can restore the
    // pre-transition snapshot from the old key.
    await writeQueue(null);
    queueKeysRef.current = new Set([`autosave_queue_${commit.storageKey}`]);
    latestDataRef.current = {
      title: commit.title,
      content: commit.content,
      documentSnapshot: commit.documentSnapshot,
      entityId: commit.entityId,
      entityMode: commit.entityMode,
      operation: "save",
      serverUpdatedAt: commit.serverUpdatedAt,
      serverContentHash: hashAutoSaveContent(commit.serverContent),
      serverContentBaseline: commit.serverContent,
      localChangedAt: Date.now(),
      localGeneration: ++localGenerationRef.current,
    };
    committedTransitionRef.current = {
      entityId: commit.entityId,
      entityMode: commit.entityMode,
    };
    acknowledgedServerRef.current = {
      ready: true,
      entityId: commit.entityId,
      entityMode: commit.entityMode,
      serverUpdatedAt: commit.serverUpdatedAt,
      serverContent: commit.serverContent,
    };
    isDirtyRef.current = false;
    setIsDirty(false);
    setStatus("saved");
    transitionLockRef.current = false;
  }, [writeQueue]);

  const stageCleanup = useCallback(async (entityId?: string) => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    clearRetryTimer();
    // Any older completion may still finish physically, but it must not clear
    // this newer recovery snapshot.
    dirtyEpochRef.current++;
    latestDataRef.current = {
      ...latestDataRef.current,
      title: "",
      content: "",
      operation: "delete",
      cleanupId: `delete:${entityId ?? latestDataRef.current.entityId ?? latestDataRef.current.creationId ?? "pending"}`,
      ...(entityId ? { entityId } : {}),
    };
    isDirtyRef.current = false;
    setIsDirty(false);
    setStatus("idle");
    await writeQueue({ ...latestDataRef.current });
  }, [clearRetryTimer, writeQueue]);

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
      try {
        await rejectAfter(activeSaveRef.current, saveTimeoutMs, "active autosave request");
      } catch {
        setStatus("error");
        return { ok: false };
      }
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
  }, [clearRetryTimer, status, doSave, saveTimeoutMs]);

  const retry = useCallback(async () => {
    if (status !== "error") return;
    clearRetryTimer();
    if (activeSaveRef.current) {
      try {
        await rejectAfter(activeSaveRef.current, saveTimeoutMs, "active autosave retry");
      } catch {
        setStatus("error");
      }
      return;
    }
    retryCountRef.current = 0;
    savingRef.current = false;
    await doSave();
  }, [clearRetryTimer, status, doSave, saveTimeoutMs]);

  const reportFailure = useCallback(async () => {
    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
      debounceTimerRef.current = null;
    }
    clearRetryTimer();
    isDirtyRef.current = true;
    setIsDirty(true);
    setStatus("error");
    try {
      await writeQueue({ ...latestDataRef.current });
    } catch {
      // The status must still leave the editor retryable even if local storage
      // itself is temporarily unavailable.
    }
  }, [clearRetryTimer, writeQueue]);

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

  return {
    status,
    isDirty,
    markDirty,
    markTitleDirty,
    flush,
    retry,
    reportFailure,
    discard,
    bindEntity,
    persistLatest,
    prepareTransition,
    abortTransition,
    commitTransition,
    stageCleanup,
    runPendingCleanup,
  };
}
