/**
 * useInboxLetterCards
 *
 * Thin adapter that converts raw InboxItem API responses to LetterCardViewModel.
 * Screens import this hook instead of mapping InboxItem fields by hand, so a
 * single fix here propagates everywhere the inbox list is displayed.
 */

import type { InboxItem } from "@workspace/api-client-react";
import type { LetterCardViewModel } from "@/types/letterCard";

function getInboxSenderName(item: InboxItem): string {
  return item.senderDisplayName ?? item.sender?.nickname ?? item.sender?.id ?? "참여자";
}

export function inboxItemToViewModel(item: InboxItem): LetterCardViewModel {
  return {
    source: "inbox",
    id: item.id,
    article: item.article ?? null,
    collectionName: item.collectionName ?? null,
    spaceName: null,
    visibility: null,
    cover: item.article?.cover ?? null,
    authorName: getInboxSenderName(item),
    authorId: item.sender?.id ?? item.senderId ?? null,
    date: item.visibleAt ?? null,
    isRead: item.isRead,
    collectionId: item.sourceSpaceId ? null : (item.sourceTeamCollectionId ?? null),
    spaceId: item.sourceSpaceId ?? null,
  };
}

/**
 * Returns the current visible inbox items converted to LetterCardViewModel.
 * Filtering (isRead, visibleAt) is left to the caller since the inbox screen
 * has additional search and display logic.
 */
export function useInboxLetterCards(items: InboxItem[]): LetterCardViewModel[] {
  return items.map(inboxItemToViewModel);
}
