import { getListOperatorPendingSpaceCodeRequestsQueryKey } from "@workspace/api-client-react";

export const getUserScopedOperatorPendingSpaceCodeRequestsQueryKey = (
  userId: string,
) =>
  [
    ...getListOperatorPendingSpaceCodeRequestsQueryKey(),
    { userId },
  ] as const;

export async function runOperatorPendingRetry(
  lock: { current: boolean },
  refetch: () => Promise<unknown>,
): Promise<boolean> {
  if (lock.current) return false;
  lock.current = true;
  try {
    await refetch();
    return true;
  } finally {
    lock.current = false;
  }
}