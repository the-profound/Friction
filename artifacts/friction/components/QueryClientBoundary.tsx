import React from "react";
import { QueryClientProvider } from "@tanstack/react-query";

import { queryClient } from "@/lib/queryClient";

export function QueryClientBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  // react-native-screens may temporarily render a scene without its parent
  // React context during a native transition. Re-provide the same singleton
  // client at the scene boundary so generated hooks always share one cache.
  return (
    <QueryClientProvider client={queryClient}>
      {children}
    </QueryClientProvider>
  );
}

export function renderQueryClientBoundary({
  children,
}: {
  children: React.ReactNode;
}) {
  return <QueryClientBoundary>{children}</QueryClientBoundary>;
}