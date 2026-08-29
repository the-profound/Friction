import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { ActiveReadingOwner } from "@/lib/authNavigation";

const STORAGE_KEY = "friction:activeReadingSession";

export interface ActiveReadingState extends ActiveReadingOwner {
  articleId: string;
  inboxId?: string;
  mode: string;
}

interface ActiveReadingContextValue {
  activeSession: ActiveReadingState | null;
  setActiveSession: (session: ActiveReadingState | null) => void;
  clearActiveSession: () => void;
}

const ActiveReadingContext = createContext<ActiveReadingContextValue>({
  activeSession: null,
  setActiveSession: () => {},
  clearActiveSession: () => {},
});

function isActiveReadingState(value: unknown): value is ActiveReadingState {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Partial<ActiveReadingState>;
  return (
    typeof candidate.userId === "string" &&
    candidate.userId.length > 0 &&
    typeof candidate.articleId === "string" &&
    candidate.articleId.length > 0 &&
    typeof candidate.mode === "string"
  );
}

export function ActiveReadingProvider({ children }: { children: React.ReactNode }) {
  const [activeSession, setActiveSessionState] = useState<ActiveReadingState | null>(null);
  const storageRevisionRef = useRef(0);

  useEffect(() => {
    let cancelled = false;
    const loadRevision = storageRevisionRef.current;
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (
        cancelled ||
        storageRevisionRef.current !== loadRevision ||
        !val
      ) {
        return;
      }
      try {
        const parsed: unknown = JSON.parse(val);
        if (isActiveReadingState(parsed)) {
          setActiveSessionState(parsed);
        } else {
          void AsyncStorage.removeItem(STORAGE_KEY);
        }
      } catch {
        void AsyncStorage.removeItem(STORAGE_KEY);
      }
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const setActiveSession = useCallback((session: ActiveReadingState | null) => {
    storageRevisionRef.current += 1;
    setActiveSessionState(session);
    if (session) {
      void AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      void AsyncStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const clearActiveSession = useCallback(() => {
    storageRevisionRef.current += 1;
    setActiveSessionState(null);
    void AsyncStorage.removeItem(STORAGE_KEY);
  }, []);

  return (
    <ActiveReadingContext.Provider value={{ activeSession, setActiveSession, clearActiveSession }}>
      {children}
    </ActiveReadingContext.Provider>
  );
}

export function useActiveReading(): ActiveReadingContextValue {
  return useContext(ActiveReadingContext);
}
