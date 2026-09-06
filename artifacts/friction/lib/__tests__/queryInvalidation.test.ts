import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import {
  getGetArticleQueryKey,
  getGetThoughtQueryKey,
  getGetThoughtQuestionQueueQueryKey,
  getListArticlesQueryKey,
  getListThoughtsQueryKey,
} from "@workspace/api-client-react";

import {
  invalidateDirectThoughtCreation,
  getProtectedArticleDetailSnapshot,
  removeRecordFromCache,
  removeThoughtQuestionFromQueueCache,
  restoreRecordDeletion,
  restoreRecordListCaches,
  seedRecordDetailCaches,
  setThoughtQuestionQueueCache,
  snapshotRecordDeletion,
  snapshotRecordListCaches,
  stageArticleTransitionSnapshot,
  upsertArticleInRecordCaches,
  upsertThoughtInRecordCaches,
} from "../queryInvalidation";
import { buildUnifiedRecords, mergeRecordSession } from "../recordList";

describe("question queue cache updates", () => {
  it("removes only the selected question and advances current and next", () => {
    const queryClient = new QueryClient();
    const queue = ["question-a", "question-b", "question-c"].map((id) => ({ id }));
    queryClient.setQueryData(getGetThoughtQuestionQueueQueryKey(), {
      current: queue[0],
      next: queue[1],
      queue,
    });

    removeThoughtQuestionFromQueueCache(queryClient, "question-a");

    expect(queryClient.getQueryData(getGetThoughtQuestionQueueQueryKey())).toEqual({
      current: queue[1],
      next: queue[2],
      queue: [queue[1], queue[2]],
    });
  });

  it("keeps an empty queue valid after deleting its final question", () => {
    const queryClient = new QueryClient();
    const question = { id: "last-question" };
    queryClient.setQueryData(getGetThoughtQuestionQueueQueryKey(), {
      current: question,
      next: null,
      queue: [question],
    });

    removeThoughtQuestionFromQueueCache(queryClient, question.id);

    expect(queryClient.getQueryData(getGetThoughtQuestionQueueQueryKey())).toEqual({
      current: null,
      next: null,
      queue: [],
    });
  });
});

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

  it("keeps equal-createdAt order unchanged from cache upsert through refetch", () => {
    const queryClient = new QueryClient();
    const createdAt = "2026-09-05T00:00:00.000Z";
    const thoughtA = {
      id: "same-time-a",
      createdAt,
      updatedAt: createdAt,
    };
    const thoughtZ = {
      id: "same-time-z",
      createdAt,
      updatedAt: createdAt,
    };
    queryClient.setQueryData(getListThoughtsQueryKey(), [thoughtA]);

    upsertThoughtInRecordCaches(queryClient, thoughtZ as never);
    const optimistic = buildUnifiedRecords(
      queryClient.getQueryData(getListThoughtsQueryKey()),
      [],
    );
    const refetched = buildUnifiedRecords([thoughtA, thoughtZ] as never, []);
    const reconciled = mergeRecordSession(optimistic, refetched);

    expect(optimistic.map((record) => record.id)).toEqual(["same-time-z", "same-time-a"]);
    expect(reconciled.map((record) => record.id)).toEqual(["same-time-z", "same-time-a"]);
  });
});

describe("promoted article cache handoff", () => {
  it("adds the confirmed snapshot only to article lists whose filters match", () => {
    const queryClient = new QueryClient();
    const allKey = getListArticlesQueryKey({ authorId: "author" });
    const dividingKey = getListArticlesQueryKey({ authorId: "author", status: "DIVIDING" });
    const letterKey = getListArticlesQueryKey({ authorId: "author", status: "LETTER" });
    const matchingTitleKey = getListArticlesQueryKey({ titleQuery: "최신" });
    const otherTitleKey = getListArticlesQueryKey({ titleQuery: "다른 제목" });
    const otherAuthorKey = getListArticlesQueryKey({ authorId: "other-author" });
    queryClient.setQueryData(allKey, []);
    queryClient.setQueryData(dividingKey, []);
    queryClient.setQueryData(letterKey, []);
    queryClient.setQueryData(matchingTitleKey, []);
    queryClient.setQueryData(otherTitleKey, []);
    queryClient.setQueryData(otherAuthorKey, []);

    const promoted = {
      id: "promoted",
      authorId: "author",
      title: "최신 제목",
      content: "최신 본문",
      status: "DIVIDING",
      createdAt: "2026-09-06T00:00:00.000Z",
      updatedAt: "2026-09-06T00:00:00.000Z",
      pages: [],
    };
    upsertArticleInRecordCaches(queryClient, promoted as never);

    expect(queryClient.getQueryData(allKey)).toEqual([promoted]);
    expect(queryClient.getQueryData(dividingKey)).toEqual([promoted]);
    expect(queryClient.getQueryData(letterKey)).toEqual([]);
    expect(queryClient.getQueryData(matchingTitleKey)).toEqual([promoted]);
    expect(queryClient.getQueryData(otherTitleKey)).toEqual([]);
    expect(queryClient.getQueryData(otherAuthorKey)).toEqual([]);
  });
});

describe("record detail cache seeding", () => {
  it("opens thought and every article stage from list snapshots while detail refreshes", async () => {
    const queryClient = new QueryClient();
    const thought = {
      id: "thought-1",
      content: "# 목록 단상\n\n바로 보이는 본문",
      updatedAt: "2026-09-02T01:00:00.000Z",
    };
    const articles = ["DIVIDING", "CLOSING", "LETTER"].map((status, index) => ({
      id: `article-${index}`,
      title: `${status} 제목`,
      content: `${status} 본문`,
      status,
      updatedAt: `2026-09-02T0${index + 2}:00:00.000Z`,
    }));

    seedRecordDetailCaches(queryClient, {
      thoughts: [thought as never],
      articles: articles as never,
    });

    let resolveDetail: ((value: typeof thought) => void) | undefined;
    const observer = new QueryObserver(queryClient, {
      queryKey: getGetThoughtQueryKey(thought.id),
      queryFn: () => new Promise<typeof thought>((resolve) => {
        resolveDetail = resolve;
      }),
      staleTime: 0,
    });
    const unsubscribe = observer.subscribe(() => {});

    expect(observer.getCurrentResult()).toMatchObject({
      data: thought,
      isLoading: false,
      isFetching: true,
    });
    for (const article of articles) {
      expect(queryClient.getQueryData(getGetArticleQueryKey(article.id))).toEqual(article);
    }

    const newerThought = {
      ...thought,
      content: "# 서버 단상\n\n더 최신인 본문",
      updatedAt: "2026-09-02T05:00:00.000Z",
    };
    resolveDetail?.(newerThought);
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().data).toEqual(newerThought);
    });
    unsubscribe();
  });

  it("does not let an older or same-version list refresh replace newer detail state", () => {
    const queryClient = new QueryClient();
    const detailKey = getGetArticleQueryKey("article-1");
    const current = {
      id: "article-1",
      title: "로컬 최신 제목",
      content: "로컬 최신 본문",
      status: "CLOSING",
      updatedAt: "2026-09-02T05:00:00.000Z",
    };
    queryClient.setQueryData(detailKey, current);

    seedRecordDetailCaches(queryClient, {
      articles: [
        { ...current, title: "오래된 목록 제목", updatedAt: "2026-09-02T04:00:00.000Z" },
        { ...current, title: "같은 버전 목록 제목" },
      ] as never,
    });

    expect(queryClient.getQueryData(detailKey)).toEqual(current);
  });

  it("updates a detail entry when the refreshed list snapshot is newer", () => {
    const queryClient = new QueryClient();
    const detailKey = getGetThoughtQueryKey("thought-1");
    const older = {
      id: "thought-1",
      content: "이전 내용",
      updatedAt: "2026-09-02T01:00:00.000Z",
    };
    const newer = {
      ...older,
      content: "목록에서 받은 최신 내용",
      updatedAt: "2026-09-02T02:00:00.000Z",
    };
    queryClient.setQueryData(detailKey, older);

    seedRecordDetailCaches(queryClient, { thoughts: [newer as never] });

    expect(queryClient.getQueryData(detailKey)).toEqual(newer);
  });
});

describe("optimistic record cache operations", () => {
  it("keeps the staged destination in front of a later stale detail response", () => {
    const queryClient = new QueryClient();
    const detailKey = getGetArticleQueryKey("article-1");
    const original = {
      id: "article-1",
      status: "DIVIDING",
      title: "이전 제목",
      content: "이전 본문",
      updatedAt: "2026-01-01T00:00:00.000Z",
    };
    queryClient.setQueryData(detailKey, original as never);

    stageArticleTransitionSnapshot(queryClient, original.id, {
      title: "최신 제목",
      content: "최신 본문",
      status: "CLOSING" as never,
    });

    const lateResponse = { ...original, updatedAt: "2026-01-01T00:00:01.000Z" };
    queryClient.setQueryData(detailKey, lateResponse as never);

    expect(getProtectedArticleDetailSnapshot(queryClient, original.id, lateResponse as never))
      .toMatchObject({
        title: "최신 제목",
        content: "최신 본문",
        status: "CLOSING",
      });
  });

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