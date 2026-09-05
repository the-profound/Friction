import { useCallback, useSyncExternalStore } from "react";
import { onlineManager } from "@tanstack/react-query";

/**
 * React-subscribed view of the app-wide `onlineManager` (wired through the
 * startup-safe NetInfo adapter in app/_layout.tsx). Use this to gate or explain network-dependent user
 * actions — manual refresh, "다시 시도" retry buttons — with a clear offline
 * notice, instead of silently calling `refetch()` on a query that React
 * Query will simply pause until connectivity returns.
 *
 * Do not use this to decide whether to *render* cached data: queries already
 * keep their last-known-good `data` while paused offline, so screens should
 * just render `query.data` unconditionally. This hook is only for the
 * "should I let this network-dependent action proceed, or tell the user
 * why it can't" decision.
 */
export function useIsOnline(): boolean {
  return useSyncExternalStore(
    useCallback((onStoreChange) => onlineManager.subscribe(onStoreChange), []),
    () => onlineManager.isOnline(),
    // Server snapshot (SSR/first paint) — assume online, matches onlineManager's own default.
    () => true,
  );
}
