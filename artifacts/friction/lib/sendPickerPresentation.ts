import type { InboxItem, SpaceListItem } from "@workspace/api-client-react";

/**
 * The inbox endpoint returns both read and unread rows. Reply selection is
 * intentionally limited to one visible, completed letter per article.
 */
export function filterReadReplyLetters(
  items: InboxItem[],
  nowMs: number = Date.now(),
): InboxItem[] {
  const seenArticleIds = new Set<string>();
  return [...items]
    .filter(
      (item) =>
        item.isRead === true &&
        item.article?.status === "LETTER" &&
        new Date(item.visibleAt).getTime() <= nowMs,
    )
    .sort(
      (a, b) =>
        new Date(b.visibleAt).getTime() - new Date(a.visibleAt).getTime(),
    )
    .filter((item) => {
      const articleId = item.article?.id;
      if (!articleId || seenArticleIds.has(articleId)) return false;
      seenArticleIds.add(articleId);
      return true;
    });
}

/**
 * listSpaces is already scoped to the user, but retaining the role check here
 * prevents a future endpoint expansion from exposing unapproved invitations.
 */
export function filterActiveParticipatingSpaces(
  spaces: SpaceListItem[],
): SpaceListItem[] {
  return spaces.filter(
    (space) =>
      space.status === "ACTIVE" &&
      (space.myRole === "OPERATOR" || space.myRole === "PARTICIPANT"),
  );
}