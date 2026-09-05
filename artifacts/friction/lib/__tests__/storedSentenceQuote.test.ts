import type { StoredSentence } from "@workspace/api-client-react";
import { describe, expect, it } from "vitest";
import {
  buildStoredSentenceQuote,
  getStoredSentenceQuoteAttribution,
} from "../storedSentenceQuote";

const sentence = (
  overrides: Partial<StoredSentence> = {},
): StoredSentence => ({
  id: "sentence-1",
  userId: "user-1",
  articleId: "article-1",
  text: "인용할 문장",
  sourceText: null,
  position: null,
  isFavorite: false,
  favoritedAt: null,
  createdAt: "2026-09-05T00:00:00.000Z",
  articleTitle: "연결된 글",
  articleAuthorName: "저자",
  ...overrides,
});

describe("stored sentence quote source", () => {
  it("prefers a manually entered source over the connected article", () => {
    expect(getStoredSentenceQuoteAttribution(sentence({
      sourceText: "직접 입력한 출처",
      position: { page: 4 },
    }))).toBe("직접 입력한 출처");
  });

  it("falls back to the connected article title and one-based page", () => {
    expect(getStoredSentenceQuoteAttribution(sentence({
      sourceText: "  ",
      position: { page: 2 },
    }))).toBe("<연결된 글>, 3면");
  });

  it("omits attribution when no source information exists", () => {
    const quote = buildStoredSentenceQuote(sentence({
      articleId: null,
      articleTitle: null,
      articleAuthorName: null,
      sourceText: null,
    }));

    expect(quote).toEqual({ text: "인용할 문장" });
    expect(JSON.stringify(quote)).not.toContain("undefined");
  });
});