import { describe, expect, it, vi } from "vitest";
import {
  getGetThoughtQuestionQueueQueryKey,
  getListArticlesQueryKey,
  getListThoughtsQueryKey,
} from "@workspace/api-client-react";

import {
  invalidateDirectThoughtCreation,
  removeRecordFromCache,
  restoreRecordListCaches,
  setThoughtQuestionQueueCache,
  snapshotRecordListCaches,
  upsertThoughtInRecordCaches,
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
      getQueryData: vi.fn((key) => cache.get(JSON.stringify(key))),
      setQueryData: vi.fn((key, value) => {
        const cacheKey = JSON.stringify(key);
        cache.set(
          cacheKey,
          typeof value === "function" ? value(cache.get(cacheKey)) : value,
        );
      }),
    };

    const snapshot = snapshotRecordListCaches(queryClient as never);
    removeRecordFromCache(queryClient as never, { id: "thought-1", kind: "thought" });
    expect(cache.get(JSON.stringify(getListThoughtsQueryKey()))).toEqual([]);
    restoreRecordListCaches(queryClient as never, snapshot);

    expect(cache.get(JSON.stringify(getListThoughtsQueryKey()))).toEqual([{ id: "thought-1" }]);
    expect(cache.get(JSON.stringify(thoughtKey))).toEqual([{ id: "thought-1" }]);
  });

  it("applies an activation response to the queue and ordinary thought caches together", () => {
    const queueKey = getGetThoughtQuestionQueueQueryKey();
    const thoughtKey = getListThoughtsQueryKey();
    const filteredThoughtKey = [...thoughtKey, { sourceArticleId: "source-a" }];
    const cache = new Map<string, unknown>([
      [JSON.stringify(queueKey), { current: { id: "old-question" }, next: null, queue: [{ id: "old-question" }] }],
      [JSON.stringify(thoughtKey), [{ id: "activated", updatedAt: "2026-01-01T00:00:00.000Z" }]],
      [JSON.stringify(filteredThoughtKey), [{ id: "source-a-thought", updatedAt: "2026-01-02T00:00:00.000Z" }]],
    ]);
    const queryClient = {
      setQueryData: vi.fn((key, value) => {
        const cacheKey = JSON.stringify(key);
        cache.set(
          cacheKey,
          typeof value === "function" ? value(cache.get(cacheKey)) : value,
        );
      }),
      setQueriesData: vi.fn(({ queryKey }, updater) => {
        for (const [key, value] of [...cache.entries()]) {
          if (JSON.parse(key)[0] === queryKey[0]) cache.set(key, updater(value));
        }
      }),
    };
    const activatedThought = {
      id: "activated",
      updatedAt: "2026-01-03T00:00:00.000Z",
      status: "NORMAL",
    };
    const response = {
      current: { id: "next-question" },
      next: null,
      queue: [{ id: "next-question" }],
      activatedThought,
    };

    setThoughtQuestionQueueCache(queryClient as never, response as never);
    upsertThoughtInRecordCaches(queryClient as never, activatedThought as never);

    expect(cache.get(JSON.stringify(queueKey))).toEqual({
      current: { id: "next-question" },
      next: null,
      queue: [{ id: "next-question" }],
    });
    expect(cache.get(JSON.stringify(thoughtKey))).toEqual([activatedThought]);
    expect(cache.get(JSON.stringify(filteredThoughtKey))).toEqual([
      { id: "source-a-thought", updatedAt: "2026-01-02T00:00:00.000Z" },
    ]);
  });
});