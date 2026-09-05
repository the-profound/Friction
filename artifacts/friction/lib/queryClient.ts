import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Treat cached data as fresh for 30s to avoid refetch spinners during
      // quick tab switches.
      staleTime: 30_000,
      // Keep inactive data for brief tab departures.
      gcTime: 5 * 60_000,
      // Cover a transient mobile network failure without an unbounded retry.
      retry: 1,
      // Replace stale in-memory data after the device regains connectivity.
      refetchOnReconnect: "always",
    },
    mutations: {
      // Mutations may be non-idempotent, so retries stay user initiated.
      retry: 0,
    },
  },
});