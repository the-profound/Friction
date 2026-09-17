import type {
  Article,
  InboxItem,
  SpaceListItem,
} from "@workspace/api-client-react";

export type SendSpaceLetterVisibility = "PUBLIC" | "RECIPIENT_ONLY";

export function defaultSendSpaceLetterVisibility(
  space: Pick<SpaceListItem, "isAnonymous">,
): SendSpaceLetterVisibility {
  return space.isAnonymous ? "RECIPIENT_ONLY" : "PUBLIC";
}

export function resolveSendSpaceLetterVisibilitySelection({
  previousSpace,
  previousVisibility,
  nextSpace,
}: {
  previousSpace: Pick<SpaceListItem, "id" | "isAnonymous"> | null;
  previousVisibility: SendSpaceLetterVisibility;
  nextSpace: Pick<SpaceListItem, "id" | "isAnonymous">;
}): SendSpaceLetterVisibility {
  if (
    previousSpace?.id === nextSpace.id &&
    previousSpace.isAnonymous === nextSpace.isAnonymous
  ) {
    return previousVisibility;
  }
  return defaultSendSpaceLetterVisibility(nextSpace);
}

export interface SortableLetterPickerItem {
  id: string;
  title: string;
  sortAt: string;
}

export function sortAndFilterLetterPickerItems<
  T extends SortableLetterPickerItem,
>(items: T[], titleQuery: string): T[] {
  const normalizedQuery = titleQuery.trim().toLocaleLowerCase();
  return items
    .filter(
      (item) =>
        !normalizedQuery ||
        item.title.toLocaleLowerCase().includes(normalizedQuery),
    )
    .map((item, sourceIndex) => ({ item, sourceIndex }))
    .sort((a, b) => {
      const dateDifference =
        (Date.parse(b.item.sortAt) || 0) - (Date.parse(a.item.sortAt) || 0);
      return dateDifference || a.sourceIndex - b.sourceIndex;
    })
    .map(({ item }) => item);
}

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
    ? (replyCandidates.find(
        (item) => item.article?.id === article.sourceArticleId,
      ) ?? null)
    : null;

  return {
    mode: source ? ("reply" as const) : ("person" as const),
    replyInbox: source,
  };
}

export type PrefillArticleState =
  | { kind: "none" }
  | { kind: "ready"; article: Article }
  | { kind: "loading" }
  | { kind: "error" }
  | { kind: "missing" };

export function resolvePrefillArticleState({
  prefillArticleId,
  articles,
  isLoading,
  isError,
}: {
  prefillArticleId?: string;
  articles: Article[];
  isLoading: boolean;
  isError: boolean;
}): PrefillArticleState {
  if (!prefillArticleId) return { kind: "none" };
  const article = articles.find((item) => item.id === prefillArticleId);
  if (article) return { kind: "ready", article };
  if (isLoading) return { kind: "loading" };
  if (isError) return { kind: "error" };
  return { kind: "missing" };
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

/**
 * Narrows an already-reply-eligible inbox list (see filterReadReplyLetters)
 * down to the ones delivered through one specific Space. GET /inbox already
 * excludes rows where senderId === recipientId, so "letters I sent myself in
 * this space" can never appear here — no extra author check is needed.
 */
export function filterReplyLettersBySpace(
  items: InboxItem[],
  spaceId: string,
): InboxItem[] {
  return items.filter((item) => item.sourceSpaceId === spaceId);
}
