/**
 * useRecordLetterCards
 *
 * Adapter that converts the combined article + SpaceLetter data from the
 * 기록 tab into LetterCardViewModel. Includes the auth guard for
 * useListUserSpaceLetters that was the root cause of bug #1865.
 *
 * The 기록 tab now sources spaceLetterByArticleId from useLetterSelectionOverlay
 * directly; this hook is provided for future screens that need a standalone
 * conversion with the same auth guard semantics.
 */

import { useMemo } from "react";
import { useListUserSpaceLetters, SpaceLetterVisibility } from "@workspace/api-client-react";
import type { Article, SpaceLetter } from "@workspace/api-client-react";
import type { LetterCardViewModel } from "@/types/letterCard";

export function useRecordSpaceLetterMap(
  userId: string | null | undefined,
  authIsLoading: boolean,
): ReadonlyMap<string, SpaceLetter> {
  const query = useListUserSpaceLetters(userId ?? "", {
    query: {
      // Auth guard: do not fetch while userId is absent or auth is still
      // resolving. This prevents the unauthed empty response from polluting
      // the cache with an empty list that hides the user's own space letters.
      enabled: Boolean(userId) && !authIsLoading,
    },
  });

  return useMemo<ReadonlyMap<string, SpaceLetter>>(() => {
    const map = new Map<string, SpaceLetter>();
    for (const sl of (query.data ?? []) as SpaceLetter[]) {
      if (!sl.sourceArticleId) continue;
      const existing = map.get(sl.sourceArticleId);
      // PUBLIC wins: prefer the PUBLIC entry when one article appears in
      // multiple spaces so the badge and toggle reflect the broadest visibility.
      if (!existing || sl.visibility === SpaceLetterVisibility.PUBLIC) {
        map.set(sl.sourceArticleId, sl);
      }
    }
    return map;
  }, [query.data]);
}

export function recordArticleToViewModel(
  article: Article,
  spaceLetter?: SpaceLetter | null,
): LetterCardViewModel {
  return {
    source: "record",
    id: article.id,
    article,
    collectionName: article.collectionName ?? null,
    spaceName: spaceLetter?.spaceName ?? null,
    visibility: spaceLetter?.visibility ?? null,
    cover: article.cover ?? null,
    authorName: article.authorNickname ?? null,
    authorId: article.authorId ?? null,
    date: (article as any).letterAt ?? article.createdAt ?? null,
    isRead: null,
    collectionId: article.collectionId ?? null,
    spaceId: spaceLetter?.spaceId ?? null,
  };
}
