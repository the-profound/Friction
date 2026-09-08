import { describe, expect, it } from "vitest";
import { markdownToHtml } from "../markdownRenderer";
import { normalizeMarkdownEmphasisDelimiters } from "../markdownEmphasis";

describe("Markdown emphasis boundary round trips", () => {
  it.each([
    ["\\*\\*문장 시작\\*\\*", "**문장 시작**"],
    ["앞 문장\n\\*\\*줄바꿈 직후\\*\\*", "앞 문장\n**줄바꿈 직후**"],
    ["\\*\\*첫\\*\\* 일반 \\*\\*둘째\\*\\*", "**첫** 일반 **둘째**"],
  ])("restores escaped strong delimiters: %j", (input, expected) => {
    expect(normalizeMarkdownEmphasisDelimiters(input)).toBe(expected);
  });

  it("keeps isolated literal asterisks intact", () => {
    expect(normalizeMarkdownEmphasisDelimiters("계산식 2 \\* 2")).toBe(
      "계산식 2 \\* 2",
    );
  });

  it.each([
    "**문장 시작**부터",
    "앞 문장\n**줄바꿈 직후**",
    "**첫** 일반 **둘째**",
    "**첫 줄\n둘째 줄**",
    "***굵고\n기울인 문장***",
  ])("renders the closing-screen HTML without visible delimiters: %s", (markdown) => {
    const html = markdownToHtml(markdown);
    expect(html).toContain("<strong>");
    expect(html).not.toContain("**");
  });

  it("does not expose a leaked blank-paragraph marker in closing HTML", () => {
    const html = markdownToHtml(
      "**앞**\n\nFRICTIONEMPTYBLANKPARAGRAPH\n\n*뒤*",
    );
    expect(html).toContain("<strong>앞</strong>");
    expect(html).toContain("<em>뒤</em>");
    expect(html).not.toContain("FRICTIONEMPTYBLANKPARAGRAPH");
  });
});