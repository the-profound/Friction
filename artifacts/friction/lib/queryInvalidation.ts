import type { QueryClient } from "@tanstack/react-query";
import type { QueryKey } from "@tanstack/react-query";
import {
  getGetArticleQueryKey,
  getGetThoughtQueryKey,
  getListArticlesQueryKey,
  getListThoughtsQueryKey,
  getGetThoughtQuestionQueueQueryKey,
  getListInboxQueryKey,
  getListMyCollectionsQueryKey,
  getListMyCollectionArticlesQueryKey,
  getGetMyCollectionQueryKey,
  getListTeamCollectionsQueryKey,
  getListTeamArticlesQueryKey,
  getGetUserRecentCollectionQueryKey,
} from "@workspace/api-client-react";
import type {
  Article,
  InboxItem,
  Thought,
  ThoughtQuestionQueueResponse,
} from "@workspace/api-client-react";
import { compareRecordsNewestFirst } from "./recordList";

/**
 * 도메인별로 자주 함께 호출되는 invalidate 시퀀스를 한곳에 모아 두는 헬퍼.
 *
 * 사용 규칙
 * - raw 문자열 query key (`["/api/inbox"]` 등) 은 사용하지 않는다. 모두 codegen
 *   `getXxxQueryKey()` 헬퍼로 통일한다. 본 모듈의 함수는 그 헬퍼를 감싼 얇은
 *   래퍼이며, 같은 화면에서 5~13번 반복되던 invalidate 호출 묶음을 1회로
 *   줄인다.
 * - 무인자 list helper (`getListInboxQueryKey()`) 는 `["/api/inbox"]` 를
 *   반환해 React Query 의 prefix 매칭으로 모든 필터 조합을 invalidate 한다.
 */

export function invalidateArticleLists(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: getListArticlesQueryKey() });
}

export function invalidateThoughtLists(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: getListThoughtsQueryKey() });
}

type RecordDetailSnapshot = Article | Thought;

type OptimisticArticleTransition = {
  generation: number;
  stagedAt: number;
  patch: Partial<Article>;
};

let articleTransitionGeneration = 0;
const optimisticArticleTransitions = new Map<string, OptimisticArticleTransition>();

function snapshotIsNewer(
  incoming: RecordDetailSnapshot,
  current: RecordDetailSnapshot | undefined,
) {
  if (!current) return true;
  const incomingUpdatedAt = Date.parse(incoming.updatedAt);
  const currentUpdatedAt = Date.parse(current.updatedAt);
  if (!Number.isFinite(incomingUpdatedAt) || !Number.isFinite(currentUpdatedAt)) {
    return false;
  }
  return incomingUpdatedAt > currentUpdatedAt;
}

/**
 * Keep a transition snapshot in front of a late detail response until a
 * response newer than the snapshot confirms the same fields. React Query does
 * not compare server timestamps when applying a refetch, so dataUpdatedAt is
 * used as the response-generation boundary here.
 */
export function getProtectedArticleDetailSnapshot(
  qc: QueryClient,
  id: string,
  incoming: Article | undefined,
) {
  const transition = optimisticArticleTransitions.get(id);
  if (!transition || !incoming) return incoming;

  const state = qc.getQueryState(getGetArticleQueryKey(id));
  const matchesPatch = Object.entries(transition.patch).every(
    ([key, value]) => incoming[key as keyof Article] === value,
  );
  if (matchesPatch && (state?.dataUpdatedAt ?? 0) > transition.stagedAt) {
    optimisticArticleTransitions.delete(id);
    return incoming;
  }

  return { ...incoming, ...transition.patch };
}

/**
 * Record lists already carry the complete title/body snapshot needed by their
 * detail screens. Seed only missing or strictly older detail entries so list
 * refreshes cannot replace an optimistic transition or in-progress local edit
 * that still has the same server timestamp.
 */
export function seedRecordDetailCaches(
  qc: QueryClient,
  snapshots: {
    articles?: readonly Article[];
    thoughts?: readonly Thought[];
  },
) {
  for (const article of snapshots.articles ?? []) {
    qc.setQueryData<Article>(getGetArticleQueryKey(article.id), (current) => {
      const protectedCurrent = getProtectedArticleDetailSnapshot(qc, article.id, current);
      if (protectedCurrent && protectedCurrent !== current) return protectedCurrent;
      return snapshotIsNewer(article, current) ? article : current;
    });
  }
  for (const thought of snapshots.thoughts ?? []) {
    qc.setQueryData<Thought>(getGetThoughtQueryKey(thought.id), (current) =>
      snapshotIsNewer(thought, current) ? thought : current,
    );
  }
}

/** Direct thought creation appears in both the thought list and article-based views. */
export function invalidateDirectThoughtCreation(qc: QueryClient) {
  return Promise.all([
    invalidateArticleLists(qc),
    invalidateThoughtLists(qc),
  ]);
}

export function invalidateArticleDetail(qc: QueryClient, id: string) {
  return qc.invalidateQueries({ queryKey: getGetArticleQueryKey(id) });
}

/** Article list + 단일 article 의 detail 을 함께 invalidate. */
export function invalidateArticleAndLists(qc: QueryClient, id: string) {
  return Promise.all([
    invalidateArticleLists(qc),
    invalidateArticleDetail(qc, id),
  ]);
}

export function invalidateInbox(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: getListInboxQueryKey() });
}

export function invalidateMyCollections(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: getListMyCollectionsQueryKey() });
}

/** my-collection 상세 화면에서 함께 갱신해야 하는 article list + collection meta. */
export function invalidateMyCollectionDetail(qc: QueryClient, collectionId: string) {
  return Promise.all([
    qc.invalidateQueries({ queryKey: getListMyCollectionArticlesQueryKey(collectionId) }),
    qc.invalidateQueries({ queryKey: getGetMyCollectionQueryKey(collectionId) }),
  ]);
}

export function invalidateTeamCollections(qc: QueryClient) {
  return qc.invalidateQueries({ queryKey: getListTeamCollectionsQueryKey() });
}

export function invalidateTeamArticles(qc: QueryClient, teamId: string) {
  return qc.invalidateQueries({ queryKey: getListTeamArticlesQueryKey(teamId) });
}

export function invalidateRecentCollection(qc: QueryClient, userId: string) {
  return qc.invalidateQueries({ queryKey: getGetUserRecentCollectionQueryKey(userId) });
}

type ListCacheSnapshot<T> = Array<[QueryKey, T[] | undefined]>;

export interface RecordListCacheSnapshot {
  articles: ListCacheSnapshot<Article>;
  thoughts: ListCacheSnapshot<Thought>;
  questionQueue: ThoughtQuestionQueueResponse | undefined;
}

/**
 * A mutation can touch several filtered list queries. Snapshot all of them
 * before an optimistic record operation so an error restores the exact
 * selection and order the user had, rather than forcing a blank/loading list.
 */
export function snapshotRecordListCaches(qc: QueryClient): RecordListCacheSnapshot {
  return {
    articles: qc.getQueriesData<Article[]>({ queryKey: getListArticlesQueryKey() }),
    thoughts: qc.getQueriesData<Thought[]>({ queryKey: getListThoughtsQueryKey() }),
    questionQueue: qc.getQueryData<ThoughtQuestionQueueResponse>(
      getGetThoughtQuestionQueueQueryKey(),
    ),
  };
}

export function restoreRecordListCaches(qc: QueryClient, snapshot: RecordListCacheSnapshot) {
  for (const [queryKey, data] of snapshot.articles) qc.setQueryData(queryKey, data);
  for (const [queryKey, data] of snapshot.thoughts) qc.setQueryData(queryKey, data);
  qc.setQueryData(getGetThoughtQuestionQueueQueryKey(), snapshot.questionQueue);
}

export function removeRecordFromCache(
  qc: QueryClient,
  record: { id: string; kind: "thought" | "editing" | "letter" },
) {
  if (record.kind === "thought") {
    qc.setQueriesData<Thought[]>({ queryKey: getListThoughtsQueryKey() }, (previous) => {
      if (!previous) return previous;
      const next = previous.filter((thought) => thought.id !== record.id);
      return next.length === previous.length ? previous : next;
    });
    return;
  }
  qc.setQueriesData<Article[]>({ queryKey: getListArticlesQueryKey() }, (previous) => {
    if (!previous) return previous;
    const next = previous.filter((article) => article.id !== record.id);
    return next.length === previous.length ? previous : next;
  });
}

type RecordDeletionTarget =
  | { id: string; kind: "thought"; thought: Thought }
  | { id: string; kind: "editing" | "letter"; article: Article };

interface RecordDeletionCacheEntry<T> {
  queryKey: QueryKey;
  item: T;
}

export interface RecordDeletionRollback {
  id: string;
  kind: "thought" | "editing" | "letter";
  thoughtEntries: Array<RecordDeletionCacheEntry<Thought>>;
  articleEntries: Array<RecordDeletionCacheEntry<Article>>;
}

/** Snapshot only the target so a late failure cannot overwrite unrelated cache changes. */
export function snapshotRecordDeletion(
  qc: QueryClient,
  record: RecordDeletionTarget,
): RecordDeletionRollback {
  const rollback: RecordDeletionRollback = {
    id: record.id,
    kind: record.kind,
    thoughtEntries: [],
    articleEntries: [],
  };
  if (record.kind === "thought") {
    for (const [queryKey, data] of qc.getQueriesData<Thought[]>({ queryKey: getListThoughtsQueryKey() })) {
      const index = data?.findIndex((thought) => thought.id === record.id) ?? -1;
      if (index >= 0) rollback.thoughtEntries.push({ queryKey, item: data![index] });
    }
  } else {
    for (const [queryKey, data] of qc.getQueriesData<Article[]>({ queryKey: getListArticlesQueryKey() })) {
      const index = data?.findIndex((article) => article.id === record.id) ?? -1;
      if (index >= 0) rollback.articleEntries.push({ queryKey, item: data![index] });
    }
  }
  return rollback;
}

/** Restore the failed target while keeping every other pending deletion hidden. */
export function restoreRecordDeletion(
  qc: QueryClient,
  rollback: RecordDeletionRollback,
  pendingDeleteIds: ReadonlySet<string> = new Set(),
) {
  const restoreEntries = <T extends { id: string; updatedAt: string }>(
    entries: Array<RecordDeletionCacheEntry<T>>,
  ) => {
    for (const entry of entries) {
      qc.setQueryData<T[]>(entry.queryKey, (current) => {
        if (!current) return current;
        const withoutOtherPendingDeletes = current.filter(
          (item) => item.id === rollback.id || !pendingDeleteIds.has(item.id),
        );
        const withRestoredTarget = withoutOtherPendingDeletes.some((item) => item.id === rollback.id)
          ? withoutOtherPendingDeletes
          : [...withoutOtherPendingDeletes, entry.item];
        return [...withRestoredTarget].sort((left, right) => {
          const timeDiff = new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime();
          return timeDiff || left.id.localeCompare(right.id);
        });
      });
    }
  };
  restoreEntries(rollback.thoughtEntries);
  restoreEntries(rollback.articleEntries);
}

export function patchThoughtInRecordCaches(qc: QueryClient, id: string, patch: Partial<Thought>) {
  qc.setQueriesData<Thought[]>({ queryKey: getListThoughtsQueryKey() }, (previous) => {
    if (!previous) return previous;
    let changed = false;
    const next = previous.map((thought) => {
      if (thought.id !== id) return thought;
      changed = true;
      return { ...thought, ...patch };
    });
    return changed ? next : previous;
  });
}

/**
 * A queue activation returns the final normal thought and the next queue
 * snapshot together. Update only the unfiltered archive list: filtered thought
 * queries may have source constraints the activated thought does not satisfy.
 */
export function upsertThoughtInRecordCaches(qc: QueryClient, thought: Thought) {
  qc.setQueryData<Thought[]>(getListThoughtsQueryKey(), (previous) => {
    if (!previous) return previous;
    const withoutCurrent = previous.filter((item) => item.id !== thought.id);
    return [...withoutCurrent, thought].sort(compareRecordsNewestFirst);
  });
}

/**
 * Mutation responses are the authoritative queue order. Preserve only the
 * stable query shape so callers can pass either a queue read or a mutation
 * response that carries extra fields such as activatedThought/requeued.
 */
export function setThoughtQuestionQueueCache(
  qc: QueryClient,
  queue: ThoughtQuestionQueueResponse,
) {
  qc.setQueryData<ThoughtQuestionQueueResponse>(getGetThoughtQuestionQueueQueryKey(), {
    current: queue.current,
    next: queue.next,
    queue: queue.queue,
  });
}

export function removeThoughtQuestionFromQueueCache(
  qc: QueryClient,
  thoughtId: string,
) {
  qc.setQueryData<ThoughtQuestionQueueResponse>(
    getGetThoughtQuestionQueueQueryKey(),
    (previous) => {
      if (!previous) return previous;
      const queue = previous.queue.filter((thought) => thought.id !== thoughtId);
      if (queue.length === previous.queue.length) return previous;
      return {
        current: queue[0] ?? null,
        next: queue[1] ?? null,
        queue,
      };
    },
  );
}

export function patchArticleInRecordCaches(qc: QueryClient, id: string, patch: Partial<Article>) {
  qc.setQueriesData<Article[]>({ queryKey: getListArticlesQueryKey() }, (previous) => {
    if (!previous) return previous;
    let changed = false;
    const next = previous.map((article) => {
      if (article.id !== id) return article;
      changed = true;
      return { ...article, ...patch };
    });
    return changed ? next : previous;
  });
}

/**
 * Cancel older article reads before publishing a local transition snapshot.
 * Query cancellation is initiated synchronously; navigation does not wait for
 * the network or cancellation promise to settle.
 */
export function stageArticleTransitionSnapshot(
  qc: QueryClient,
  id: string,
  patch: Partial<Article>,
  baseSnapshot?: Article,
) {
  const stagedAt = Date.now();
  optimisticArticleTransitions.set(id, {
    generation: ++articleTransitionGeneration,
    stagedAt,
    patch,
  });
  void Promise.allSettled([
    qc.cancelQueries({ queryKey: getGetArticleQueryKey(id), exact: true }),
    qc.cancelQueries({ queryKey: getListArticlesQueryKey() }),
  ]);
  qc.setQueryData<Article>(
    getGetArticleQueryKey(id),
    (previous) => (previous ? { ...previous, ...patch } : baseSnapshot ? { ...baseSnapshot, ...patch } : previous),
    { updatedAt: stagedAt },
  );
  patchArticleInRecordCaches(qc, id, patch);
}

/** Add a newly-created direct thought to the unfiltered record cache immediately. */
export function insertThoughtInRecordCache(qc: QueryClient, thought: Thought) {
  qc.setQueryData<Thought[] | undefined>(getListThoughtsQueryKey(), (previous) => {
    if (!previous) return previous;
    const withoutCurrent = previous.filter((item) => item.id !== thought.id);
    return [thought, ...withoutCurrent].sort(
      (left, right) =>
        new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime()
        || left.id.localeCompare(right.id),
    );
  });
}

// ── 낙관적 캐시 업데이트 헬퍼 ────────────────────────────────────────────────
//
// 응답 형태가 단순한 inbox mutation 은 invalidateQueries 대신 setQueriesData
// 로 즉시 캐시를 갱신해 화면 깜빡임을 줄인다. setQueriesData 의 첫 인자에
// `getListInboxQueryKey()` (= `["/api/inbox"]`) 를 주면 recipientId/isRead
// 등의 필터로 분기된 모든 inbox 캐시 항목을 한 번에 갱신할 수 있다.

export function patchInboxItemInCache(
  qc: QueryClient,
  inboxId: string,
  patch: Partial<InboxItem>,
) {
  qc.setQueriesData<InboxItem[] | undefined>(
    { queryKey: getListInboxQueryKey() },
    (prev) => {
      if (!prev) return prev;
      let changed = false;
      const next = prev.map((item) => {
        if (item.id !== inboxId) return item;
        changed = true;
        return { ...item, ...patch };
      });
      return changed ? next : prev;
    },
  );
}

export function removeInboxItemFromCache(qc: QueryClient, inboxId: string) {
  qc.setQueriesData<InboxItem[] | undefined>(
    { queryKey: getListInboxQueryKey() },
    (prev) => {
      if (!prev) return prev;
      const next = prev.filter((item) => item.id !== inboxId);
      return next.length === prev.length ? prev : next;
    },
  );
}
