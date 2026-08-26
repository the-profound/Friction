import { useCallback, useEffect, useRef } from "react";

const PRESS_GUARD_MS = 180;

/**
 * Briefly suppresses card presses after a parent vertical list starts moving.
 * React Native Web can emit a trailing click after a drag has been handed off
 * to the list, so this guard is shared by date-group screens and carousels.
 */
export function useScrollPressGuard() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isScrollingRef = useRef(false);

  const onScroll = useCallback(() => {
    isScrollingRef.current = true;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      isScrollingRef.current = false;
      timerRef.current = null;
    }, PRESS_GUARD_MS);
  }, []);

  const shouldIgnoreVerticalPress = useCallback(() => isScrollingRef.current, []);

  useEffect(() => () => {
    if (timerRef.current) clearTimeout(timerRef.current);
  }, []);

  return { onScroll, shouldIgnoreVerticalPress };
}