import { describe, expect, it } from "vitest";
import { myArticleToViewModel } from "../../hooks/useMyLetterCards";
import type { Article } from "@workspace/api-client-react";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const OTHER_AUTHOR_ID = "20000000-0000-4000-8000-000000000002";

function makeArticle(overrides: Partial<Article> = {}): Article {
  return {
    id: "art-1",
    authorId: OWNER_ID,
    title: "제목",
    content: "",
    status: "LETTER",
    createdAt: "2026-09-01T00:00:00.000Z",
    updatedAt: "2026-09-01T00:00:00.000Z",
    ...overrides,
  } as Article;
}

describe("myArticleToViewModel identity masking (of-01-detail personal collection grid)", () => {
  it("shows the real author name and a tappable authorId for a self-authored letter", () => {
    const article = makeArticle({ authorId: OWNER_ID, authorNickname: "실명" });
    const vm = myArticleToViewModel(article);
    expect(vm.authorName).toBe("실명");
    expect(vm.authorId).toBe(OWNER_ID);
  });

  it("never exposes authorId for a foreign letter whose author identity was masked server-side", () => {
    // Mirrors listMyCollectionArticles' response shape for a letter saved from
    // someone else's anonymous-space letter into the impression collection.
    const article = makeArticle({
      authorId: OTHER_AUTHOR_ID,
      authorNickname: "달빛", // already the safe per-space display name, not the real nickname
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...( { authorIdentityMasked: true } as any ),
    });
    const vm = myArticleToViewModel(article);
    expect(vm.authorName).toBe("달빛");
    expect(vm.authorId).toBeNull();
  });

  it("keeps a real, tappable authorId for a foreign letter from a non-anonymous space", () => {
    const article = makeArticle({
      authorId: OTHER_AUTHOR_ID,
      authorNickname: "실명",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...( { authorIdentityMasked: false } as any ),
    });
    const vm = myArticleToViewModel(article);
    expect(vm.authorName).toBe("실명");
    expect(vm.authorId).toBe(OTHER_AUTHOR_ID);
  });

  it("prefers the server-resolved article.spaceName/spaceId pair over an own-authored spaceLetter fallback", () => {
    const article = makeArticle({
      authorId: OTHER_AUTHOR_ID,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...( { spaceName: "가을 편지 모임", spaceId: "space-autumn" } as any ),
    });
    // No matching spaceLetter is passed (foreign author — the current user's
    // own /users/:id/space-letters lookup can never contain someone else's letter).
    const vm = myArticleToViewModel(article, null);
    expect(vm.spaceName).toBe("가을 편지 모임");
    expect(vm.spaceId).toBe("space-autumn");
  });

  it("gives a foreign-authored letter with no matching spaceLetter a live, tappable spaceId (regression: overlay Space link was previously always inactive for these)", () => {
    // Mirrors listMyCollectionArticles' response for a letter someone else
    // authored and the collection owner saved — the owner's own
    // spaceLetterByArticleId map (from GET /users/:id/space-letters) can
    // never contain this article, so spaceId must come from the article
    // itself, not silently fall back to null.
    const article = makeArticle({
      authorId: OTHER_AUTHOR_ID,
      authorNickname: "달빛",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...( {
        authorIdentityMasked: true,
        spaceName: "겨울 편지 모임",
        spaceId: "space-winter",
      } as any ),
    });
    const vm = myArticleToViewModel(article, null);
    expect(vm.spaceName).toBe("겨울 편지 모임");
    expect(vm.spaceId).toBe("space-winter");
  });

  it("keeps the displayed space name and its navigation id as one matching pair, even when a stale spaceLetter argument names a different Space", () => {
    // An article resubmitted into a second Space can still have an older
    // spaceLetterByArticleId entry for the first Space. Once the server
    // resolves article.spaceName/spaceId as a pair (listMyCollectionArticles),
    // that pair must win outright — never mix article.spaceName with the
    // stale spaceLetter's spaceId, or the label would navigate to the wrong Space.
    const article = makeArticle({
      authorId: OWNER_ID,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      ...( { spaceName: "봄 편지 모임", spaceId: "space-spring" } as any ),
    });
    const vm = myArticleToViewModel(article, {
      spaceName: "여름 편지 모임",
      spaceId: "space-summer",
      visibility: "PUBLIC",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(vm.spaceName).toBe("봄 편지 모임");
    expect(vm.spaceId).toBe("space-spring");
  });

  it("falls back to the own-authored spaceLetter's spaceName+spaceId pair when the article carries no Space metadata at all (마이 탭 path, GET /articles)", () => {
    const article = makeArticle({ authorId: OWNER_ID });
    const vm = myArticleToViewModel(article, {
      spaceName: "겨울 편지 모임",
      spaceId: "space-1",
      visibility: "PUBLIC",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any);
    expect(vm.spaceName).toBe("겨울 편지 모임");
    expect(vm.spaceId).toBe("space-1");
  });
});
