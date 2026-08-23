import { describe, expect, it, vi } from "vitest";
import { getListArticlesQueryKey, getListThoughtsQueryKey } from "@workspace/api-client-react";

import {
  invalidateDirectThoughtCreation,
  removeRecordFromCache,
  restoreRecordListCaches,
  snapshotRecordListCaches,
} from "../queryInvalidation";

describe("direct thought creation cache invalidation", () => {
  it("refreshes both records sources when returning from a new thought", async () => {
    const invalidateQueries = vi.fn().mockResolvedValue(undefined);
    const queryClient = { invalidateQueries };

    await invalidateDirectThoughtCreation(queryClient as never);

    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getListArticlesQueryKey(),
    });
    expect(invalidateQueries).toHaveBeenCalledWith({
      queryKey: getListThoughtsQueryKey(),
    });
    expect(invalidateQueries).toHaveBeenCalledTimes(2);
  });
});

describe("optimistic record cache operations", () => {
  it("restores every filtered list snapshot when a deletion fails", () => {
    const thoughtKey = [...getListThoughtsQueryKey(), { sourceArticleId: "source" }];
    const articleKey = [...getListArticlesQueryKey(), { status: "LETTER" }];
    const cache = new Map<string, unknown>([
      [JSON.stringify(getListThoughtsQueryKey()), [{ id: "thought-1" }]],
      [JSON.stringify(thoughtKey), [{ id: "thought-1" }]],
      [JSON.stringify(articleKey), [{ id: "article-1" }]],
    ]);
    const queryClient = {
      getQueriesData: vi.fn(({ queryKey }) => [...cache.entries()]
        .filter(([key]) => JSON.parse(key)[0] === queryKey[0])
        .map(([key, value]) => [JSON.parse(key), value])),
      setQueriesData: vi.fn(({ queryKey }, updater) => {
        for (const [key, value] of [...cache.entries()]) {
          if (JSON.parse(key)[0] === queryKey[0]) cache.set(key, updater(value));
        }
      }),
      setQueryData: vi.fn((key, value) => cache.set(JSON.stringify(key), value)),
    };

    const snapshot = snapshotRecordListCaches(queryClient as never);
    removeRecordFromCache(queryClient as never, { id: "thought-1", kind: "thought" });
    expect(cache.get(JSON.stringify(getListThoughtsQueryKey()))).toEqual([]);
    restoreRecordListCaches(queryClient as never, snapshot);

    expect(cache.get(JSON.stringify(getListThoughtsQueryKey()))).toEqual([{ id: "thought-1" }]);
    expect(cache.get(JSON.stringify(thoughtKey))).toEqual([{ id: "thought-1" }]);
  });
});