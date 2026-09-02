import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  getGetArticleQueryKey,
  getGetThoughtQuestionQueueQueryKey,
  getListArticlesQueryKey,
  getListThoughtsQueryKey,
} from "@workspace/api-client-react";

import {
  invalidateDirectThoughtCreation,
  removeRecordFromCache,
  restoreRecordDeletion,
  restoreRecordListCaches,
  setThoughtQuestionQueueCache,
  snapshotRecordDeletion,
  snapshotRecordListCaches,
  stageArticleTransitionSnapshot,
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
  it("keeps a local stage transition when an older detail request finishes late", async () => {
    const queryClient = new QueryClient();
    const articleKey = getListArticlesQueryKey({ authorId: "author" });
    const closingArticle = {
      id: "article-1",
      status: "CLOSING",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    const detailKey = getGetArticleQueryKey(closingArticle.id);
    queryClient.setQueryData(articleKey, [closingArticle]);
    queryClient.setQueryData(detailKey, closingArticle);

    let resolveRequest: ((value: typeof closingArticle) => void) | undefined;
    const request = queryClient.fetchQuery({
      queryKey: detailKey,
      queryFn: ({ signal }) => new Promise<typeof closingArticle>((resolve, reject) => {
        resolveRequest = resolve;
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      }),
    }).catch(() => undefined);
    await Promise.resolve();

    stageArticleTransitionSnapshot(queryClient, closingArticle.id, {
      status: "DIVIDING" as never,
    });
    resolveRequest?.(closingArticle);
    await request;

    expect(queryClient.getQueryData(detailKey)).toMatchObject({
      id: closingArticle.id,
      status: "DIVIDING",
    });
    expect(queryClient.getQueryData(articleKey)).toEqual([
      { ...closingArticle, status: "DIVIDING" },
    ]);
  });

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

  it("merges the failed target into a newer refetch without losing its results", () => {
    const queryClient = new QueryClient();
    const thoughtKey = getListThoughtsQueryKey();
    const filteredKey = [...thoughtKey, { sourceArticleId: "source" }];
    const original = { id: "thought-1", updatedAt: "2026-01-02T00:00:00.000Z" };
    const older = { id: "thought-2", updatedAt: "2026-01-01T00:00:00.000Z" };
    queryClient.setQueryData(thoughtKey, [original, older]);
    queryClient.setQueryData(filteredKey, [original]);
    const rollback = snapshotRecordDeletion(queryClient, {
      id: original.id,
      kind: "thought",
      thought: original as never,
    });
    removeRecordFromCache(queryClient, { id: original.id, kind: "thought" });
    queryClient.setQueryData(thoughtKey, (current: Array<{ id: string }> | undefined) => [
      { id: "thought-3", updatedAt: "2026-01-03T00:00:00.000Z" },
      ...(current ?? []),
    ]);
    const refreshedFiltered = [
      { id: "thought-filtered", updatedAt: "2026-01-05T00:00:00.000Z" },
    ];
    queryClient.setQueryData(filteredKey, refreshedFiltered);

    restoreRecordDeletion(queryClient, rollback);

    expect(queryClient.getQueryData(thoughtKey)).toEqual([
      { id: "thought-3", updatedAt: "2026-01-03T00:00:00.000Z" },
      original,
      older,
    ]);
    expect(queryClient.getQueryData(filteredKey)).toEqual([
      refreshedFiltered[0],
      original,
    ]);
  });

  it("keeps concurrent thought failure and article success isolated", () => {
    const queryClient = new QueryClient();
    const thoughtKey = getListThoughtsQueryKey();
    const articleKey = getListArticlesQueryKey({ authorId: "author" });
    const thought = { id: "thought-1", updatedAt: "2026-01-02T00:00:00.000Z" };
    const otherThought = { id: "thought-2", updatedAt: "2026-01-01T00:00:00.000Z" };
    const article = { id: "article-1", updatedAt: "2026-01-02T00:00:00.000Z" };
    const otherArticle = { id: "article-2", updatedAt: "2026-01-01T00:00:00.000Z" };
    queryClient.setQueryData(thoughtKey, [thought, otherThought]);
    queryClient.setQueryData(articleKey, [article, otherArticle]);
    const thoughtRollback = snapshotRecordDeletion(queryClient, {
      id: thought.id,
      kind: "thought",
      thought: thought as never,
    });
    removeRecordFromCache(queryClient, { id: thought.id, kind: "thought" });
    removeRecordFromCache(queryClient, { id: article.id, kind: "editing" });

    restoreRecordDeletion(queryClient, thoughtRollback, new Set([thought.id, article.id]));

    expect(queryClient.getQueryData(thoughtKey)).toEqual([thought, otherThought]);
    expect(queryClient.getQueryData(articleKey)).toEqual([otherArticle]);
  });

  it("restores same-list failures immediately while keeping the other delete isolated", () => {
    const queryClient = new QueryClient();
    const thoughtKey = getListThoughtsQueryKey();
    const records = [
      { id: "thought-a", updatedAt: "2026-01-03T00:00:00.000Z" },
      { id: "thought-b", updatedAt: "2026-01-02T00:00:00.000Z" },
      { id: "thought-c", updatedAt: "2026-01-01T00:00:00.000Z" },
    ];
    queryClient.setQueryData(thoughtKey, records);
    const rollbackA = snapshotRecordDeletion(queryClient, {
      id: records[0].id,
      kind: "thought",
      thought: records[0] as never,
    });
    removeRecordFromCache(queryClient, { id: records[0].id, kind: "thought" });
    const rollbackB = snapshotRecordDeletion(queryClient, {
      id: records[1].id,
      kind: "thought",
      thought: records[1] as never,
    });
    removeRecordFromCache(queryClient, { id: records[1].id, kind: "thought" });

    const pendingIds = new Set([records[0].id, records[1].id]);
    restoreRecordDeletion(queryClient, rollbackA, pendingIds);
    expect(queryClient.getQueryData(thoughtKey)).toEqual([records[0], records[2]]);

    pendingIds.delete(records[0].id);
    restoreRecordDeletion(queryClient, rollbackB, pendingIds);
    expect(queryClient.getQueryData(thoughtKey)).toEqual(records);
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