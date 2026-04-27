/**
 * Team Collection 글 목록 정렬·그루핑 유틸
 *
 * KST 18:00 컷오프 규칙:
 *   - visibleAt의 KST 시각이 18:00 미만 → 해당 날짜 그룹
 *   - visibleAt의 KST 시각이 18:00 이상 → 다음 날 그룹
 */

import type { TeamCollectionArticleWithDetails } from "@workspace/api-client-react";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * ISO 타임스탬프(또는 Date)를 KST 18:00 컷오프 기준으로 YYYY-MM-DD dateKey로 변환
 */
export function toKstDateKey(ts: string | Date): string {
  const ms = typeof ts === "string" ? new Date(ts).getTime() : ts.getTime();
  const kst = new Date(ms + KST_OFFSET_MS);
  const kstHour = kst.getUTCHours();

  let base = new Date(
    Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()),
  );
  if (kstHour >= 18) {
    base = new Date(base.getTime() + 24 * 60 * 60 * 1000);
  }
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

export function formatDateLabel(dateKey: string): string {
  const parts = dateKey.split("-");
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  const day = Number(parts[2]);
  const d = new Date(Date.UTC(year, month - 1, day));

  const nowKst = new Date(Date.now() + KST_OFFSET_MS);
  const todayKey = `${nowKst.getUTCFullYear()}-${String(nowKst.getUTCMonth() + 1).padStart(2, "0")}-${String(nowKst.getUTCDate()).padStart(2, "0")}`;
  const todayMs = new Date(
    Date.UTC(
      Number(todayKey.split("-")[0]),
      Number(todayKey.split("-")[1]) - 1,
      Number(todayKey.split("-")[2]),
    ),
  ).getTime();

  const diffDays = Math.round((todayMs - d.getTime()) / (1000 * 60 * 60 * 24));

  if (diffDays === 0) return "오늘";
  if (diffDays === 1) return "어제";
  if (diffDays < 7) return `${diffDays}일 전`;
  return `${year}.${String(month).padStart(2, "0")}.${String(day).padStart(2, "0")}`;
}

export type TeamArticleListRow =
  | { type: "header"; dateKey: string; label: string }
  | { type: "article"; item: TeamCollectionArticleWithDetails; indent: boolean; isNoticeOfDay: boolean };

/**
 * TeamCollectionArticleWithDetails 배열을 KST 일자 그룹 + 정렬 규칙에 따라
 * FlatList에 바로 넣을 수 있는 row 배열로 변환한다.
 *
 * 정렬 규칙 (그룹 내):
 *   1. 오늘의 인사(`isNotice && noticeDate === dateKey`) → 맨 위 (답장이어도 여기)
 *   2. 나머지는 visibleAt 최신순
 *   3. 같은 모음의 글에 대한 답장(`sourceArticleId && parentInThisCollection`)은
 *      원글 바로 아래에 고정 1단계 들여쓰기로 붙인다
 *      (답장이더라도 오늘의 인사이면 맨 위로)
 */
type ArticleWithKey = TeamCollectionArticleWithDetails & { _dateKey: string };

/**
 * DFS helper: inserts `item` (at the given indent) then recursively
 * inserts all known replies to that item (at fixed 1-level indent),
 * depth-first. This ensures "답장의 답장도 같은 한 칸 들여쓰기" and that
 * every reply appears directly after its source article.
 *
 * `replyMap`: sourceArticleId → sorted list of reply articles
 * `visited`: guard against cycles (malformed data)
 */
function insertWithReplies(
  item: ArticleWithKey,
  replyMap: Map<string, ArticleWithKey[]>,
  visited: Set<string>,
  result: TeamArticleListRow[],
  indent: boolean,
): void {
  result.push({ type: "article", item, indent, isNoticeOfDay: false });
  visited.add(item.articleId);
  const children = replyMap.get(item.articleId) ?? [];
  for (const child of children) {
    if (!visited.has(child.articleId)) {
      insertWithReplies(child, replyMap, visited, result, true);
    }
  }
}

export function buildTeamArticleRows(
  articles: TeamCollectionArticleWithDetails[],
): TeamArticleListRow[] {
  if (articles.length === 0) return [];

  // 각 항목에 dateKey 부여
  // visibleAt이 없는 경우(soft-deleted placeholder 등) addedAt 기준으로 대체
  const withKeys: ArticleWithKey[] = articles.map((a) => {
    const ts = a.visibleAt ?? a.addedAt;
    return { ...a, _dateKey: toKstDateKey(ts) };
  });

  // 날짜 그룹 맵 (최신순 정렬 먼저)
  const groupMap = new Map<string, ArticleWithKey[]>();
  for (const a of withKeys) {
    if (!groupMap.has(a._dateKey)) groupMap.set(a._dateKey, []);
    groupMap.get(a._dateKey)!.push(a);
  }

  // dateKey 내림차순 (최신 날짜가 위)
  const sortedKeys = Array.from(groupMap.keys()).sort((a, b) => (a > b ? -1 : 1));

  const result: TeamArticleListRow[] = [];

  for (const dateKey of sortedKeys) {
    const groupItems = groupMap.get(dateKey)!;

    // 그룹 내에서 일반 정렬: 오늘의 인사 → 나머지(visibleAt 내림차순)
    const notices = groupItems.filter(
      (a) => a.article?.isNotice && a.article?.noticeDate === dateKey,
    );
    const nonNotices = groupItems.filter(
      (a) => !(a.article?.isNotice && a.article?.noticeDate === dateKey),
    );

    // 비공지 항목을 visibleAt 내림차순 정렬
    nonNotices.sort((a, b) => {
      const ta = a.visibleAt ?? a.addedAt;
      const tb = b.visibleAt ?? b.addedAt;
      return new Date(tb).getTime() - new Date(ta).getTime();
    });

    // Build ID sets for this group's notices and non-notices so we can scope
    // the DFS replyMap to parents that are actually traversed in this group.
    // Replies whose parent is in a different date group fall back to top-level.
    const nonNoticeIdSet = new Set(nonNotices.map((a) => a.articleId));
    const noticeIdSet = new Set(notices.map((a) => a.articleId));

    // DFS replyMap: sourceArticleId → [replies in this group, sorted]
    // Only keyed by parents that are traversed in THIS group (notice or non-notice).
    // Replies with a parent in a different date group will be top-level.
    const replyMap = new Map<string, ArticleWithKey[]>();
    for (const a of nonNotices) {
      if (!a.sourceArticleId || !a.parentInThisCollection || a.isDeletedPlaceholder) continue;
      const parentInThisGroup =
        nonNoticeIdSet.has(a.sourceArticleId) || noticeIdSet.has(a.sourceArticleId);
      if (!parentInThisGroup) continue; // parent in another group → render top-level
      if (!replyMap.has(a.sourceArticleId)) replyMap.set(a.sourceArticleId, []);
      replyMap.get(a.sourceArticleId)!.push(a);
    }

    // 헤더 행
    result.push({ type: "header", dateKey, label: formatDateLabel(dateKey) });

    // 오늘의 인사 먼저 (들여쓰기 없음) + 해당 공지에 대한 답장 즉시 삽입
    const visited = new Set<string>();
    for (const notice of notices) {
      result.push({ type: "article", item: notice, indent: false, isNoticeOfDay: true });
      visited.add(notice.articleId);
      for (const child of replyMap.get(notice.articleId) ?? []) {
        if (!visited.has(child.articleId)) {
          insertWithReplies(child, replyMap, visited, result, true);
        }
      }
    }

    // 독립 글(답장이 아니거나, 부모가 이 그룹에 없는 것) + DFS로 답장 끼워넣기
    // isDeletedPlaceholder는 항상 top-level (자체가 부모 역할)
    for (const item of nonNotices) {
      if (visited.has(item.articleId)) continue;
      const attachedAsReply =
        item.sourceArticleId &&
        item.parentInThisCollection &&
        !item.isDeletedPlaceholder &&
        (nonNoticeIdSet.has(item.sourceArticleId) || noticeIdSet.has(item.sourceArticleId));
      if (attachedAsReply) continue; // DFS에서 처리됨

      insertWithReplies(item, replyMap, visited, result, false);
    }
  }

  return result;
}
