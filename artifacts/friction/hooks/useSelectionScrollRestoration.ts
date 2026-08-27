import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import type {
  NativeScrollEvent,
  NativeSyntheticEvent,
} from "react-native";

export type SelectionScrollRestore = {
  offset: number;
  session: number;
};

/**
 * Small state container kept separate from the hook so the close/open and
 * reader-navigation races remain directly testable.
 */
export function createSelectionScrollRestorationState() {
  let session = 0;
  let savedRestore: SelectionScrollRestore | null = null;

  return {
    capture(offset: number) {
      session += 1;
      savedRestore = { offset, session };
    },
    cancel() {
      session += 1;
      savedRestore = null;
    },
    consumeForClose(isSelectionOpen: boolean) {
      if (isSelectionOpen || savedRestore === null) return null;
      const restore = savedRestore;
      savedRestore = null;
      return restore;
    },
    isCurrentSession(expectedSession: number) {
      return session === expectedSession;
    },
  };
}

/**
 * Keeps an underlying list at its pre-selection position while a card is shown
 * in the selection Modal. Native lists can otherwise adjust their offset after
 * the source slot is hidden and restored, particularly when it is clipped by
 * the top or bottom of the viewport.
 */
export function useSelectionScrollRestoration(
  isSelectionOpen: boolean,
  restoreScrollOffset: (offset: number) => void,
) {
  const currentOffsetRef = useRef(0);
  const restorationStateRef = useRef(createSelectionScrollRestorationState());
  const restoreFrameRef = useRef<number | null>(null);

  const handleScroll = useCallback(
    (event: NativeSyntheticEvent<NativeScrollEvent>) => {
      currentOffsetRef.current = event.nativeEvent.contentOffset.y;
    },
    [],
  );

  const captureScrollOffset = useCallback(() => {
    if (restoreFrameRef.current !== null) {
      cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
    }
    restorationStateRef.current.capture(currentOffsetRef.current);
  }, []);

  const cancelScrollRestoration = useCallback(() => {
    restorationStateRef.current.cancel();
    if (restoreFrameRef.current !== null) {
      cancelAnimationFrame(restoreFrameRef.current);
      restoreFrameRef.current = null;
    }
  }, []);

  useLayoutEffect(() => {
    const restore = restorationStateRef.current.consumeForClose(isSelectionOpen);
    if (!restore) return;

    // Restore before the source becomes visible again. Repeat on the next
    // frame because native Modal dismissal can finish after React commits the
    // source slot and otherwise apply its own visibility adjustment.
    restoreScrollOffset(restore.offset);
    restoreFrameRef.current = requestAnimationFrame(() => {
      restoreFrameRef.current = null;
      if (restorationStateRef.current.isCurrentSession(restore.session)) {
        restoreScrollOffset(restore.offset);
      }
    });
  }, [isSelectionOpen, restoreScrollOffset]);

  useEffect(
    () => () => {
      if (restoreFrameRef.current !== null) {
        cancelAnimationFrame(restoreFrameRef.current);
        restoreFrameRef.current = null;
      }
    },
    [],
  );

  return {
    handleScroll,
    captureScrollOffset,
    cancelScrollRestoration,
  };
}