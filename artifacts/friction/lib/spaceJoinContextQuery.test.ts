import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import {
  getUserScopedSpaceJoinContextQueryKey,
  isSpaceJoinContextQueryKey,
} from "./spaceJoinContextQuery";

describe("user-scoped space join-context cache keys", () => {
  it("partitions one space's context by authenticated user", () => {
    expect(getUserScopedSpaceJoinContextQueryKey("space-a", "user-a")).not.toEqual(
      getUserScopedSpaceJoinContextQueryKey("space-a", "user-b"),
    );
  });

  it("identifies join-context entries for removal across identity transitions", () => {
    expect(isSpaceJoinContextQueryKey(getUserScopedSpaceJoinContextQueryKey("space-a", "user-a"))).toBe(true);
    expect(isSpaceJoinContextQueryKey(["/api/spaces/space-a/members"])).toBe(false);
  });

  it("does not return a previous user's cached context after a user switch", () => {
    const client = new QueryClient();
    const userAKey = getUserScopedSpaceJoinContextQueryKey("space-a", "user-a");
    const userBKey = getUserScopedSpaceJoinContextQueryKey("space-a", "user-b");
    client.setQueryData(userAKey, { participation: { userId: "user-a" } });

    expect(client.getQueryData(userBKey)).toBeUndefined();

    client.removeQueries({ predicate: (query) => isSpaceJoinContextQueryKey(query.queryKey) });
    expect(client.getQueryData(userAKey)).toBeUndefined();
  });
});