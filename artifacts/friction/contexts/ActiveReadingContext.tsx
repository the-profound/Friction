import React, { createContext, useContext, useState, useCallback, useEffect } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";

const STORAGE_KEY = "friction:activeReadingSession";

interface ActiveReadingState {
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

export function ActiveReadingProvider({ children }: { children: React.ReactNode }) {
  const [activeSession, setActiveSessionState] = useState<ActiveReadingState | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(STORAGE_KEY).then((val) => {
      if (val) {
        try {
          setActiveSessionState(JSON.parse(val));
        } catch {
          AsyncStorage.removeItem(STORAGE_KEY);
        }
      }
    });
  }, []);

  const setActiveSession = useCallback((session: ActiveReadingState | null) => {
    setActiveSessionState(session);
    if (session) {
      AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else {
      AsyncStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const clearActiveSession = useCallback(() => {
    setActiveSessionState(null);
    AsyncStorage.removeItem(STORAGE_KEY);
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
