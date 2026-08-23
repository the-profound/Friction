import { useRouter } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

interface ThoughtComposerContextValue {
  createDirectThought: () => Promise<void>;
  releaseDirectThoughtDraft: () => void;
  isCreatingThought: boolean;
}

const ThoughtComposerContext = createContext<ThoughtComposerContextValue | null>(null);
/**
 * Coordinates direct "new thought" entry points. A direct draft has no server
 * record until it contains meaningful content, but it still owns this shared
 * lock so another affordance cannot open a competing local draft.
 */
export function ThoughtComposerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [isCreatingThought, setIsCreatingThought] = useState(false);
  const isCreatingRef = useRef(false);
  const isMountedRef = useRef(true);

  useEffect(() => {
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const createDirectThought = useCallback(async () => {
    if (isCreatingRef.current) return;

    isCreatingRef.current = true;
    setIsCreatingThought(true);
    router.push({ pathname: "/on-01a", params: { mode: "local-draft" } });
  }, [router]);

  const releaseDirectThoughtDraft = useCallback(() => {
    isCreatingRef.current = false;
    if (isMountedRef.current) {
      setIsCreatingThought(false);
    }
  }, []);

  const value = useMemo(
    () => ({ createDirectThought, releaseDirectThoughtDraft, isCreatingThought }),
    [createDirectThought, releaseDirectThoughtDraft, isCreatingThought],
  );

  return (
    <ThoughtComposerContext.Provider value={value}>
      {children}
    </ThoughtComposerContext.Provider>
  );
}

export function useThoughtComposer(): ThoughtComposerContextValue {
  const context = useContext(ThoughtComposerContext);
  if (!context) {
    throw new Error("useThoughtComposer must be used within ThoughtComposerProvider");
  }
  return context;
}