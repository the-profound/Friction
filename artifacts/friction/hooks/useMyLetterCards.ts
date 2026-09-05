/**
 * useMyLetterCards
 *
 * Adapter for the 마이 탭 (to.tsx) — converts the user's own articles combined
 * with their send records and optional space letter entries into LetterCardViewModel.
 * The 마이 탭 currently shows letters with collection OR space attribution.
 */

import type { Article, SpaceLetter } from "@workspace/api-client-react";
import type { LetterCardViewModel } from "@/types/letterCard";

export function myArticleToViewModel(
  article: Article,
  spaceLetter?: SpaceLetter | null,
): LetterCardViewModel {
  return {
    source: "my",
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
  };
}

/**
 * Converts articles from the 마이 탭 to ViewModels.
 * Pass spaceLetterByArticleId from useLetterSelectionOverlay for space attribution.
 */
export function useMyLetterCards(
  articles: Article[],
  spaceLetterByArticleId: ReadonlyMap<string, SpaceLetter>,
): LetterCardViewModel[] {
  return articles.map((a) =>
    myArticleToViewModel(a, spaceLetterByArticleId.get(a.id) ?? null),
  );
}
