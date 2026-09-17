import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ActiveReadingOwner } from "@/lib/authNavigation";

const STORAGE_KEY = "friction:activeReadingSession";

export interface ActiveReadingState extends ActiveReadingOwner {
  articleId: string;
  inboxId?: string;
  entrySource?: "list" | "inbox" | "space";
  mode: string;
  analyticsSessionId?: string;
  analyticsIsReread?: boolean;
  readingQuestionSessionId?: string;
}

interface ActiveReadingContextValue {
  activeSession: ActiveReadingState | null;
  isHydrated: boolean;
  setActiveSession: (session: ActiveReadingState | null) => void;
  clearActiveSession: () => void;
  refreshActiveSession: () => Promise<void>;
}

const ActiveReadingContext = createContext<ActiveReadingContextValue>({
  activeSession: null,
  isHydrated: false,
  setActiveSession: () => {},
  clearActiveSession: () => {},
  refreshActiveSession: async () => {},
});

export function isActiveReadingState(value: unknown): value is ActiveReadingState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ActiveReadingState>;
  return (
    typeof candidate.userId === "string" &&
    candidate.userId.length > 0 &&
    typeof candidate.articleId === "string" &&
    candidate.articleId.length > 0 &&
    (candidate.inboxId === undefined || typeof candidate.inboxId === "string") &&
    (candidate.analyticsSessionId === undefined || typeof candidate.analyticsSessionId === "string") &&
    (candidate.analyticsIsReread === undefined || typeof candidate.analyticsIsReread === "boolean") &&
    (candidate.readingQuestionSessionId === undefined || typeof candidate.readingQuestionSessionId === "string") &&
    (
      candidate.entrySource === undefined ||
      candidate.entrySource === "list" ||
      candidate.entrySource === "inbox" ||
      candidate.entrySource === "space"
    ) &&
    candidate.mode === "basic"
  );
}

export interface AsyncOperationQueue {
  enqueue: (operation: () => Promise<void>) => Promise<void>;
  wait: () => Promise<void>;
}

export function createAsyncOperationQueue(): AsyncOperationQueue {
  let pending: Promise<void> = Promise.resolve();
  return {
    enqueue(operation) {
      const next = pending.catch(() => undefined).then(operation);
      pending = next;
      return next;
    },
    wait() {
      return pending.catch(() => undefined);
    },
  };
}

export interface RevisionGuard {
  begin: () => number;
  invalidate: () => void;
  isCurrent: (revision: number) => boolean;
}

export function createRevisionGuard(): RevisionGuard {
  let currentRevision = 0;
  return {
    begin() {
      currentRevision += 1;
      return currentRevision;
    },
    invalidate() {
      currentRevision += 1;
    },
    isCurrent(revision) {
      return currentRevision === revision;
    },
  };
}

export function ActiveReadingProvider({ children }: { children: React.ReactNode }) {
  const [activeSession, setActiveSessionState] = useState<ActiveReadingState | null>(null);
  const [isHydrated, setIsHydrated] = useState(false);
  const revisionGuardRef = useRef<RevisionGuard>(createRevisionGuard());
  const storageQueueRef = useRef<AsyncOperationQueue>(createAsyncOperationQueue());
  const mountedRef = useRef(true);

  const refreshActiveSession = useCallback(async () => {
    const loadRevision = revisionGuardRef.current.begin();
    try {
      let val: string | null = null;
      await storageQueueRef.current.enqueue(async () => {
        val = await AsyncStorage.getItem(STORAGE_KEY);
      });
      if (!mountedRef.current || !revisionGuardRef.current.isCurrent(loadRevision)) return;

      if (!val) {
        setActiveSessionState(null);
        return;
      }

      try {
        const parsed: unknown = JSON.parse(val);
        if (isActiveReadingState(parsed)) {
          setActiveSessionState(parsed);
        } else {
          await storageQueueRef.current.enqueue(() => AsyncStorage.removeItem(STORAGE_KEY));
          if (mountedRef.current && revisionGuardRef.current.isCurrent(loadRevision)) {
            setActiveSessionState(null);
          }
        }
      } catch {
        await storageQueueRef.current.enqueue(() => AsyncStorage.removeItem(STORAGE_KEY));
        if (mountedRef.current && revisionGuardRef.current.isCurrent(loadRevision)) {
          setActiveSessionState(null);
        }
      }
    } catch {
      if (mountedRef.current && revisionGuardRef.current.isCurrent(loadRevision)) {
        setActiveSessionState(null);
      }
    } finally {
      if (mountedRef.current && revisionGuardRef.current.isCurrent(loadRevision)) {
        setIsHydrated(true);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    void refreshActiveSession();
    return () => {
      mountedRef.current = false;
    };
  }, [refreshActiveSession]);

  const setActiveSession = useCallback((session: ActiveReadingState | null) => {
    revisionGuardRef.current.invalidate();
    setActiveSessionState(session);
    setIsHydrated(true);
    if (session) {
      void storageQueueRef.current.enqueue(() =>
        AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session)),
      );
    } else {
      void storageQueueRef.current.enqueue(() => AsyncStorage.removeItem(STORAGE_KEY));
    }
  }, []);

  const clearActiveSession = useCallback(() => {
    revisionGuardRef.current.invalidate();
    setActiveSessionState(null);
    setIsHydrated(true);
    void storageQueueRef.current.enqueue(() => AsyncStorage.removeItem(STORAGE_KEY));
  }, []);

  return (
    <ActiveReadingContext.Provider
      value={{
        activeSession,
        isHydrated,
        setActiveSession,
        clearActiveSession,
        refreshActiveSession,
      }}
    >
      {children}
    </ActiveReadingContext.Provider>
  );
}

export function useActiveReading(): ActiveReadingContextValue {
  return useContext(ActiveReadingContext);
}
