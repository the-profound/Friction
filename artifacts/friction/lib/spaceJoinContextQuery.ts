import { getGetSpaceJoinContextQueryKey } from "@workspace/api-client-react";

export function getUserScopedSpaceJoinContextQueryKey(spaceId: string, userId: string | undefined) {
  return [
    ...getGetSpaceJoinContextQueryKey(spaceId),
    { userId: userId ?? "unresolved" },
  ] as const;
}

export function isSpaceJoinContextQueryKey(queryKey: readonly unknown[]) {
  return typeof queryKey[0] === "string" &&
    /^\/api\/spaces\/[^/]+\/join-context$/.test(queryKey[0]);
}