/**
 * useProfileLetterCards
 *
 * Adapter for the user profile screen and recipient-only-letters screen.
 * Converts articles returned from the profile API into LetterCardViewModel.
 * Profile pages show PUBLIC letters only (enforced server-side), so visibility
 * is not included in the ViewModel.
 */

import type { Article } from "@workspace/api-client-react";
import type { LetterCardViewModel } from "@/types/letterCard";

export function profileArticleToViewModel(article: Article): LetterCardViewModel {
  return {
    source: "profile",
    id: article.id,
    article,
    collectionName: article.collectionName ?? null,
    spaceName: (article as any).spaceName ?? null,
    visibility: null,
    cover: article.cover ?? null,
    authorName: article.authorNickname ?? null,
    authorId: article.authorId ?? null,
    date: (article as any).letterAt ?? article.createdAt ?? null,
    isRead: null,
    collectionId: article.collectionId ?? null,
  };
}

/**
 * Converts articles from a user profile page to ViewModels.
 * These are always PUBLIC letters — visibility column is omitted.
 */
export function useProfileLetterCards(articles: Article[]): LetterCardViewModel[] {
  return articles.map(profileArticleToViewModel);
}
