import { getListOperatorPendingSpaceCodeRequestsQueryKey } from "@workspace/api-client-react";

export const getUserScopedOperatorPendingSpaceCodeRequestsQueryKey = (
  userId: string,
) =>
  [
    ...getListOperatorPendingSpaceCodeRequestsQueryKey(),
    { userId },
  ] as const;