/**
 * useSpaceLetterCards
 *
 * Adapter that converts SpaceLetter list API responses (from the space detail
 * screen) into LetterCardViewModel. Encodes space-specific display rules:
 * - Author identity is masked in anonymous spaces (displayName shown instead)
 * - Space name is the collection label (no personal collection)
 */

import type { SpaceLetter } from "@workspace/api-client-react";
import type { LetterCardViewModel } from "@/types/letterCard";
import { getSpaceLetterAuthorName } from "@/lib/spaceRoundPresentation";

export function spaceLetterToViewModel(
  letter: SpaceLetter,
  spaceName: string,
  isAnonymousSpace: boolean,
): LetterCardViewModel {
  const authorNickname = (letter as any).authorNickname as string | null;
  const displayName = (letter as any).displayName as string | null;
  const authorName = getSpaceLetterAuthorName(
    letter.letterType,
    isAnonymousSpace,
    displayName,
    authorNickname,
  );

  return {
    source: "space",
    id: letter.id,
    article: null,
    collectionName: null,
    spaceName,
    visibility: null,
    cover: ((letter as any).articleCover ?? null) as import("@workspace/api-client-react").ArticleCover | null,
    authorName,
    authorId: isAnonymousSpace ? null : letter.authorId ?? null,
    date: letter.createdAt,
    isRead: letter.isRead,
    collectionId: null,
  };
}

/**
 * Converts a list of SpaceLetters from a space's letter carousel to ViewModels.
 * The screen renders cards directly from SpaceLetter data (with embedded article
 * cover/title from the API join), so the article field is left null.
 */
export function useSpaceLetterCards(
  letters: SpaceLetter[],
  spaceName: string,
  isAnonymousSpace: boolean,
): LetterCardViewModel[] {
  return letters.map((l) => spaceLetterToViewModel(l, spaceName, isAnonymousSpace));
}
