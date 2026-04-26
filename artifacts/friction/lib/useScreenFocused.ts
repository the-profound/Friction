import { useCallback, useState } from "react";
import { useFocusEffect } from "expo-router";

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
