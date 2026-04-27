import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";
import type { QueryClient } from "@tanstack/react-query";

/**
 * Tracks whether the current screen is focused (i.e. the active route in the
 * navigation stack). The cleanup function fires when the screen is blurred
 * OR unmounted, so consumers can safely use the boolean to gate background
 * work like polling — it stops as soon as the user leaves the screen.
 */
export function useScreenFocused(): boolean {
  const [focused, setFocused] = useState(false);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );
  return focused;
}

/**
 * Default interval used to poll "incoming item" queries (inbox letters,
 * neighbor requests, team-collection memberships) so freshly-arrived items
 * surface within a few seconds of being sent during cross-testing.
 */
export const INCOMING_POLL_INTERVAL_MS = 15000;

/**
 * Slower polling interval used as a safety-net fallback when realtime
 * subscriptions are also active. Realtime push delivers sub-second updates;
 * the polling interval only needs to cover the rare case where the realtime
 * channel is unavailable (e.g. the table isn't in the publication, the
 * websocket connection failed, etc.). Bumping this from 15s to 60s cuts
 * background request volume by 4× without compromising eventual freshness.
 */
export const INCOMING_FALLBACK_POLL_INTERVAL_MS = 60000;

/**
 * Returns React Query options that enable a focus-gated polling interval
 * on a generated `useListX` / `useGetX` hook. Polling stops automatically
 * when the screen is blurred or unmounted.
 *
 * Usage:
 *   const pollOpts = useFocusPollingOptions();
 *   const { data } = useListInbox({ recipientId }, pollOpts);
 *
 * The orval-generated wrappers type their `query` option with strict per-hook
 * generics (data type, query key) and require `queryKey` even though the
 * wrapper supplies one itself. Returning `any` from this helper sidesteps the
 * cross-hook type incompatibility while keeping the runtime payload simple
 * and uniform.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function useFocusPollingOptions(intervalMs: number = INCOMING_POLL_INTERVAL_MS): any {
  const focused = useScreenFocused();
  return {
    query: {
      refetchInterval: focused ? intervalMs : false,
    },
  };
}

/**
 * How old cached query data must be (in ms) before a focus-triggered refetch
 * is allowed. Must match the global `staleTime` configured in the QueryClient.
 */
export const FOCUS_STALE_THRESHOLD_MS = 30_000;

/**
 * Returns `true` if the query identified by `queryKey` has no cached data, or
 * if its cached data is older than `thresholdMs` (defaults to
 * `FOCUS_STALE_THRESHOLD_MS`).
 *
 * Use this in `useFocusEffect` callbacks to skip unnecessary refetches when
 * the user switches tabs quickly — data that was just fetched should not be
 * re-requested, as doing so causes a full loading indicator and a potential
 * scroll-position jump.
 *
 * Example:
 *   useFocusEffect(useCallback(() => {
 *     if (isQueryStale(queryClient, getListInboxQueryKey({ recipientId }))) {
 *       refetch();
 *     }
 *   }, [queryClient, refetch, recipientId]));
 */
export function isQueryStale(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  thresholdMs: number = FOCUS_STALE_THRESHOLD_MS,
): boolean {
  const state = queryClient.getQueryState(queryKey);
  if (!state?.dataUpdatedAt) return true;
  return Date.now() - state.dataUpdatedAt > thresholdMs;
}
