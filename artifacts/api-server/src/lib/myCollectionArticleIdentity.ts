import { ANONYMOUS_PARTICIPANT_NAME } from "./anonymousSpaceIdentity";

/**
 * Resolves the safe author display name for one row of
 * GET /my-collections/:id/articles.
 *
 * Personal collections (notably the built-in "인상깊은 편지" collection) can hold
 * letters authored by users other than the collection owner. When such a
 * letter originated from an anonymous Space, the real account nickname must
 * never be shown to the collection owner — that would defeat the anonymity
 * every other Space screen enforces for the same author. Self-authored
 * letters are always shown with the real nickname; a viewer never needs
 * their own identity masked from themselves.
 */
export function resolveMyCollectionArticleAuthorIdentity(params: {
  articleAuthorId: string | null;
  collectionOwnerId: string | null;
  rawAuthorNickname: string | null;
  spaceIsAnonymous: boolean | null;
  spaceAuthorSpaceNickname: string | null;
}): { authorNickname: string | null; authorIdentityMasked: boolean } {
  const isSelfAuthored =
    params.collectionOwnerId != null &&
    params.articleAuthorId != null &&
    params.articleAuthorId === params.collectionOwnerId;

  const isAnonymousForeignLetter = !isSelfAuthored && params.spaceIsAnonymous === true;

  if (!isAnonymousForeignLetter) {
    return { authorNickname: params.rawAuthorNickname ?? null, authorIdentityMasked: false };
  }

  const safeNickname = params.spaceAuthorSpaceNickname?.trim() || ANONYMOUS_PARTICIPANT_NAME;
  return { authorNickname: safeNickname, authorIdentityMasked: true };
}
