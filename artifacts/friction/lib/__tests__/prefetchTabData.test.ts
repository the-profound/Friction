import { QueryClient, onlineManager } from "@tanstack/react-query";
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";

const mockFetchers = vi.hoisted(() => ({
  listInbox: vi.fn(async () => [] as unknown[]),
  listSpaces: vi.fn(async () => [] as unknown[]),
  listMySpaceInvitations: vi.fn(async () => [] as unknown[]),
  listMySpaceCodeRequests: vi.fn(async () => [] as unknown[]),
  listOperatorPendingSpaceCodeRequests: vi.fn(async () => [] as unknown[]),
  listMyCollections: vi.fn(async () => [] as unknown[]),
  listStoredSentences: vi.fn(async () => [] as unknown[]),
  getUser: vi.fn(async () => ({ id: "user-a" })),
  listArticles: vi.fn(async () => [] as unknown[]),
  listSendRecords: vi.fn(async () => [] as unknown[]),
  listNeighbors: vi.fn(async () => [] as unknown[]),
  listUserArticleReads: vi.fn(async () => [] as unknown[]),
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@workspace/api-client-react")>();
  return { ...actual, ...mockFetchers };
});

import {
  getListInboxQueryKey,
  getListSpacesQueryKey,
  getListMyCollectionsQueryKey,
  getGetUserQueryKey,
  getListArticlesQueryKey,
  getListNeighborsQueryKey,
} from "@workspace/api-client-react";
import { getUserScopedOperatorPendingSpaceCodeRequestsQueryKey } from "../operatorPendingSpaceCodeRequestsQuery";
import { prefetchOtherTabsFirstLayerData } from "../prefetchTabData";

// Mirrors the app's real global defaults (lib/queryClient.ts) so dedup/skip
// behavior around the 30s staleTime is exercised the same way production
// sees it; retry disabled purely to keep the failure test fast.
function makeQueryClient() {
  return new QueryClient({
    defaultOptions: { queries: { staleTime: 30_000, retry: false } },
  });
}

function resetFetcherMocks() {
  Object.values(mockFetchers).forEach((fn) => fn.mockReset());
  mockFetchers.listInbox.mockResolvedValue([]);
  mockFetchers.listSpaces.mockResolvedValue([]);
  mockFetchers.listMySpaceInvitations.mockResolvedValue([]);
  mockFetchers.listMySpaceCodeRequests.mockResolvedValue([]);
  mockFetchers.listOperatorPendingSpaceCodeRequests.mockResolvedValue([]);
  mockFetchers.listMyCollections.mockResolvedValue([]);
  mockFetchers.listStoredSentences.mockResolvedValue([]);
  mockFetchers.getUser.mockResolvedValue({ id: "user-a" });
  mockFetchers.listArticles.mockResolvedValue([]);
  mockFetchers.listSendRecords.mockResolvedValue([]);
  mockFetchers.listNeighbors.mockResolvedValue([]);
  mockFetchers.listUserArticleReads.mockResolvedValue([]);
}

describe("prefetchOtherTabsFirstLayerData", () => {
  beforeEach(() => {
    resetFetcherMocks();
    onlineManager.setOnline(true);
  });

  afterEach(() => {
    onlineManager.setOnline(true);
  });

  it("warms every 수신/공간/보관/마이 first-render query for the given user", async () => {
    const queryClient = makeQueryClient();

    await prefetchOtherTabsFirstLayerData(queryClient, "user-a");

    expect(mockFetchers.listInbox).toHaveBeenCalledTimes(1);
    expect(mockFetchers.listSpaces).toHaveBeenCalledTimes(1);
    expect(mockFetchers.listMySpaceInvitations).toHaveBeenCalledTimes(1);
    expect(mockFetchers.listMySpaceCodeRequests).toHaveBeenCalledTimes(1);
    expect(mockFetchers.listOperatorPendingSpaceCodeRequests).toHaveBeenCalledTimes(1);
    expect(mockFetchers.listMyCollections).toHaveBeenCalledTimes(1);
    expect(mockFetchers.listStoredSentences).toHaveBeenCalledTimes(1);
    expect(mockFetchers.getUser).toHaveBeenCalledTimes(1);
    expect(mockFetchers.listArticles).toHaveBeenCalledTimes(1);
    expect(mockFetchers.listSendRecords).toHaveBeenCalledTimes(1);
    expect(mockFetchers.listNeighbors).toHaveBeenCalledTimes(1);
    expect(mockFetchers.listUserArticleReads).toHaveBeenCalledTimes(1);

    // Landed under the exact same keys each destination screen's own hook reads.
    expect(
      queryClient.getQueryData(
        getListInboxQueryKey({ recipientId: "user-a", isRead: false } as never),
      ),
    ).toEqual([]);
    expect(queryClient.getQueryData(getGetUserQueryKey("user-a"))).toEqual({ id: "user-a" });
    expect(
      queryClient.getQueryData(getUserScopedOperatorPendingSpaceCodeRequestsQueryKey("user-a")),
    ).toEqual([]);
  });

  it("does nothing for a blank userId", async () => {
    const queryClient = makeQueryClient();

    await prefetchOtherTabsFirstLayerData(queryClient, "");

    expect(mockFetchers.listInbox).not.toHaveBeenCalled();
    expect(mockFetchers.getUser).not.toHaveBeenCalled();
  });

  it("skips entirely while offline, leaving cache empty for the destination screen's own fetch", async () => {
    onlineManager.setOnline(false);
    const queryClient = makeQueryClient();

    await prefetchOtherTabsFirstLayerData(queryClient, "user-a");

    expect(mockFetchers.listInbox).not.toHaveBeenCalled();
    expect(mockFetchers.getUser).not.toHaveBeenCalled();
    expect(queryClient.getQueryData(getGetUserQueryKey("user-a"))).toBeUndefined();
  });

  it("skips a query whose cache is still fresh instead of re-requesting it", async () => {
    const queryClient = makeQueryClient();
    // Simulates 기록 탭 having already populated this shared query.
    queryClient.setQueryData(getListArticlesQueryKey({ authorId: "user-a" }), [
      { id: "already-cached" },
    ]);

    await prefetchOtherTabsFirstLayerData(queryClient, "user-a");

    expect(mockFetchers.listArticles).not.toHaveBeenCalled();
    // Unrelated queries still warm normally.
    expect(mockFetchers.listInbox).toHaveBeenCalledTimes(1);
  });

  it("awaits an already in-flight fetch for the same query instead of firing a second request", async () => {
    const queryClient = makeQueryClient();
    let resolveInFlight: (value: unknown[]) => void = () => {};
    mockFetchers.listSpaces.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveInFlight = resolve;
        }),
    );

    const inFlight = queryClient.fetchQuery({
      queryKey: getListSpacesQueryKey({ userId: "user-a" }),
      queryFn: () => mockFetchers.listSpaces(),
    });

    const prefetch = prefetchOtherTabsFirstLayerData(queryClient, "user-a");
    resolveInFlight([{ id: "space-1" }]);
    await Promise.all([inFlight, prefetch]);

    expect(mockFetchers.listSpaces).toHaveBeenCalledTimes(1);
    expect(queryClient.getQueryData(getListSpacesQueryKey({ userId: "user-a" }))).toEqual([
      { id: "space-1" },
    ]);
  });

  it("swallows one query's failure without throwing or blocking the others", async () => {
    const queryClient = makeQueryClient();
    mockFetchers.listNeighbors.mockRejectedValueOnce(new Error("network down"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});

    await expect(prefetchOtherTabsFirstLayerData(queryClient, "user-a")).resolves.toBeUndefined();

    expect(queryClient.getQueryData(getListNeighborsQueryKey({ userId: "user-a" }))).toBeUndefined();
    // Other, unrelated queries still completed successfully.
    expect(queryClient.getQueryData(getGetUserQueryKey("user-a"))).toEqual({ id: "user-a" });
    warnSpy.mockRestore();
  });

  it("keys the collections query the same as both 기록 and 보관 tabs (shared cache entry)", async () => {
    const queryClient = makeQueryClient();

    await prefetchOtherTabsFirstLayerData(queryClient, "user-a");

    expect(
      queryClient.getQueryData(getListMyCollectionsQueryKey({ ownerId: "user-a" })),
    ).toEqual([]);
  });
});
