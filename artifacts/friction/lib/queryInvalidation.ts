import type { QueryClient } from "@tanstack/react-query";
import {
  getGetArticleQueryKey,
  getListArticlesQueryKey,
  getListInboxQueryKey,
  getListMyCollectionsQueryKey,
  getListMyCollectionArticlesQueryKey,
  getGetMyCollectionQueryKey,
  getListTeamCollectionsQueryKey,
  getListTeamArticlesQueryKey,
  getGetUserRecentCollectionQueryKey,
} from "@workspace/api-client-react";
import type { InboxItem } from "@workspace/api-client-react";

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
