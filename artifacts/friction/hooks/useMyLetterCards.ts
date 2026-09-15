/**
 * useMyLetterCards
 *
 * Adapter for the 마이 탭 (to.tsx) and the personal-collection detail screen
 * (of-01-detail.tsx) — converts articles combined with an optional own-authored
 * space letter entry into LetterCardViewModel.
 *
 * Personal collections (e.g. "인상깊은 편지") can hold letters authored by other
 * users. For those, `article.spaceName`/`article.spaceId`/`authorIdentityMasked`
 * come directly from listMyCollectionArticles (server-resolved from the same
 * space_letters row, safe for any author) and take priority over the
 * `spaceLetter` param, which only ever covers the current user's own authored
 * space letters (from GET /users/:id/space-letters) and can disagree with the
 * server's pick when an article was submitted to more than one Space.
 *
 * spaceName and spaceId must always be read from the SAME source (both from
 * `article`, or both from `spaceLetter`) — never mix one field from each, or
 * the displayed Space name can end up pointing at a different Space's ID.
 */

import type { Article, SpaceLetter } from "@workspace/api-client-react";
import type { LetterCardViewModel } from "@/types/letterCard";

export function myArticleToViewModel(
  article: Article,
  spaceLetter?: SpaceLetter | null,
): LetterCardViewModel {
  // authorIdentityMasked is true only when authorNickname above is already a
  // safe anonymous-Space display name rather than the author's real account
  // nickname (see listMyCollectionArticles) — never expose authorId in that
  // case, or the client could navigate straight to the real author's profile.
  const authorIdentityMasked = (article as any).authorIdentityMasked === true;
  // article.spaceName is resolved server-side (listMyCollectionArticles) from
  // the same query as article.spaceId, so the two are always a matching
  // pair — fall back to spaceLetter's own name+id pair as a whole only when
  // the article carries no Space metadata at all (e.g. endpoints other than
  // listMyCollectionArticles, which don't populate spaceName/spaceId).
  const hasArticleSpace = (article as any).spaceName != null;
  const spaceName = hasArticleSpace ? (article as any).spaceName : (spaceLetter?.spaceName ?? null);
  const spaceId = hasArticleSpace ? ((article as any).spaceId ?? null) : (spaceLetter?.spaceId ?? null);
  return {
    source: "my",
    id: article.id,
    article,
    collectionName: article.collectionName ?? null,
    spaceName,
    visibility: spaceLetter?.visibility ?? null,
    cover: article.cover ?? null,
    authorName: article.authorNickname ?? null,
    authorId: authorIdentityMasked ? null : (article.authorId ?? null),
    date: (article as any).letterAt ?? article.createdAt ?? null,
    isRead: null,
    collectionId: article.collectionId ?? null,
    spaceId,
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
