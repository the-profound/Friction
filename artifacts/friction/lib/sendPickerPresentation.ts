import type { Article, InboxItem, SpaceListItem } from "@workspace/api-client-react";

export function buildReplySendTarget(item: Pick<InboxItem, "id">) {
  return { replyToInboxId: item.id };
}

/** Keep the send picker readable even if the list join has no nickname. */
export function getSendArticleAuthorName(
  article: Pick<Article, "authorNickname">,
): string {
  return article.authorNickname?.trim() || "알 수 없음";
}

export function resolveInitialSendDefaults(
  article: Pick<Article, "sourceArticleId"> | null,
  replyCandidates: InboxItem[],
) {
  const source = article?.sourceArticleId
    ? replyCandidates.find((item) => item.article?.id === article.sourceArticleId) ?? null
    : null;

  return {
    mode: source ? ("reply" as const) : ("person" as const),
    replyInbox: source,
  };
}

/**
 * The inbox endpoint returns both read and unread rows. Reply selection is
 * intentionally limited to visible, completed deliveries. Keep repeated
 * deliveries because the inbox ID and sender determine the exact reply target.
 */
export function filterReadReplyLetters(
  items: InboxItem[],
  nowMs: number = Date.now(),
): InboxItem[] {
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
    );
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