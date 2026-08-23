import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";

import { useCreateThought } from "@workspace/api-client-react";
import { useToast } from "@/contexts/ToastContext";
import { invalidateDirectThoughtCreation } from "@/lib/queryInvalidation";

interface ThoughtComposerContextValue {
  createDirectThought: () => Promise<void>;
  isCreatingThought: boolean;
}

const ThoughtComposerContext = createContext<ThoughtComposerContextValue | null>(null);
const DUPLICATE_TAP_WINDOW_MS = 750;

/**
 * Coordinates every direct "new thought" entry point so a tap on a second
 * affordance cannot create another preliminary thought while the first request
 * is still in flight.
 */
export function ThoughtComposerProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const { showToast } = useToast();
  const createThought = useCreateThought();
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
    try {
      const thought = await createThought.mutateAsync({
        data: { content: "# \n\n", createdFrom: "direct", status: "PRELIMINARY" },
      });
      await invalidateDirectThoughtCreation(queryClient);
      router.push({ pathname: "/on-01a", params: { id: thought.id } });
    } catch {
      showToast({ message: "단상 생성에 실패했습니다. 다시 시도해주세요.", type: "error" });
    } finally {
      // A fast network failure can settle between two click events from a
      // double tap. Keep the shared lock briefly so that gesture is still one
      // creation attempt, while leaving a normal retry available right after.
      setTimeout(() => {
        isCreatingRef.current = false;
        if (isMountedRef.current) {
          setIsCreatingThought(false);
        }
      }, DUPLICATE_TAP_WINDOW_MS);
    }
  }, [createThought, queryClient, router, showToast]);

  const value = useMemo(
    () => ({ createDirectThought, isCreatingThought }),
    [createDirectThought, isCreatingThought],
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