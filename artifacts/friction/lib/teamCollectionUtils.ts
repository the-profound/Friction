/**
 * Team Collection 글 목록 정렬·그루핑 유틸
 *
 * 날짜 그룹핑 정책:
 *   - 모든 배달 슬롯이 KST 06:00 단일 슬롯으로 통일됨
 *   - 모임 글 목록: 순수 KST 달력 날짜 기준 (toKstCalendarDateKey 사용)
 *   - 수신함(index.tsx)도 KST 달력 날짜 기준 단일 그룹 (AM/PM 분리 없음)
 */

import type { TeamCollectionArticleWithDetails } from "@workspace/api-client-react";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * ISO 타임스탬프(또는 Date)를 KST 달력 날짜(YYYY-MM-DD)로 변환
 * 단일 슬롯(KST 06:00) 정책에 맞춰 toKstCalendarDateKey와 동일한 순수 KST 달력 날짜를 반환
 * (기존 18:00 컷오프 제거)
 */
export function toKstDateKey(ts: string | Date): string {
  return toKstCalendarDateKey(ts);
}

/**
 * ISO 타임스탬프(또는 Date)를 KST 달력 날짜(YYYY-MM-DD)로 변환
 * 18:00 컷오프 없이 순수 KST 날짜만 반환 — addedAt fallback 전용
 */
export function toKstCalendarDateKey(ts: string | Date): string {
  const ms = typeof ts === "string" ? new Date(ts).getTime() : ts.getTime();
  const kst = new Date(ms + KST_OFFSET_MS);
  return `${kst.getUTCFullYear()}-${String(kst.getUTCMonth() + 1).padStart(2, "0")}-${String(kst.getUTCDate()).padStart(2, "0")}`;
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

  // 각 항목에 dateKey 부여 (순수 KST 달력 날짜, 18:00 컷오프 없음)
  const withKeys: ArticleWithKey[] = articles.map((a) => {
    const dateKey = a.visibleAt
      ? toKstCalendarDateKey(a.visibleAt)
      : toKstCalendarDateKey(a.addedAt);
    return { ...a, _dateKey: dateKey };
  });

  // 전역 replyMap: 날짜 그룹을 넘어 원글 아래에 답장을 붙인다
  // sourceArticleId → [replies, 오래된 순]
  const globalReplyMap = new Map<string, ArticleWithKey[]>();
  const attachedReplyIds = new Set<string>();
  for (const a of withKeys) {
    if (!a.sourceArticleId || !a.parentInThisCollection || a.isDeletedPlaceholder) continue;
    if (!globalReplyMap.has(a.sourceArticleId)) globalReplyMap.set(a.sourceArticleId, []);
    globalReplyMap.get(a.sourceArticleId)!.push(a);
    attachedReplyIds.add(a.articleId);
  }
  // 답장은 오래된 순(visibleAt 오름차순)으로 원글 아래 나열
  for (const replies of globalReplyMap.values()) {
    replies.sort((a, b) => {
      const ta = a.visibleAt ?? a.addedAt;
      const tb = b.visibleAt ?? b.addedAt;
      return new Date(ta).getTime() - new Date(tb).getTime();
    });
  }

  // 루트 글만 날짜 그룹핑 (답장으로 분류된 항목 제외)
  const groupMap = new Map<string, ArticleWithKey[]>();
  for (const a of withKeys) {
    if (attachedReplyIds.has(a.articleId)) continue;
    if (!groupMap.has(a._dateKey)) groupMap.set(a._dateKey, []);
    groupMap.get(a._dateKey)!.push(a);
  }

  // dateKey 내림차순 (최신 날짜가 위)
  const sortedKeys = Array.from(groupMap.keys()).sort((a, b) => (a > b ? -1 : 1));

  const result: TeamArticleListRow[] = [];

  for (const dateKey of sortedKeys) {
    const groupItems = groupMap.get(dateKey)!;

    // 그룹 내 정렬: 오늘의 인사 → 나머지(visibleAt 내림차순)
    const notices = groupItems.filter(
      (a) => a.article?.isNotice && a.article?.noticeDate === dateKey,
    );
    const nonNotices = groupItems.filter(
      (a) => !(a.article?.isNotice && a.article?.noticeDate === dateKey),
    );

    nonNotices.sort((a, b) => {
      const ta = a.visibleAt ?? a.addedAt;
      const tb = b.visibleAt ?? b.addedAt;
      return new Date(tb).getTime() - new Date(ta).getTime();
    });

    // 헤더 행
    result.push({ type: "header", dateKey, label: formatDateLabel(dateKey) });

    // 오늘의 인사 먼저 (들여쓰기 없음) + 전역 replyMap으로 답장 DFS 삽입
    const visited = new Set<string>();
    for (const notice of notices) {
      result.push({ type: "article", item: notice, indent: false, isNoticeOfDay: true });
      visited.add(notice.articleId);
      for (const child of globalReplyMap.get(notice.articleId) ?? []) {
        if (!visited.has(child.articleId)) {
          insertWithReplies(child, globalReplyMap, visited, result, true);
        }
      }
    }

    // 나머지 루트 글 + 전역 replyMap으로 답장 DFS 삽입
    for (const item of nonNotices) {
      if (visited.has(item.articleId)) continue;
      insertWithReplies(item, globalReplyMap, visited, result, false);
    }
  }

  return result;
}
