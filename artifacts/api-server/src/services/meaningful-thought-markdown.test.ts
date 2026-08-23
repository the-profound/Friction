import { describe, expect, it } from "vitest";
import { isMeaningfulThoughtMarkdown } from "@workspace/api-zod/meaningfulThoughtMarkdown";

describe("isMeaningfulThoughtMarkdown", () => {
  it.each([
    ["# 제목\n\n본문", true],
    ["> 인용한 문장", true],
    ["# 질문\n\n오늘 가장 기억나는 일은 무엇인가요?", true],
    ["![](https://cdn.example.com/photo.jpg)", true],
    ["![](#)", true],
    ["```\n코드 안의 실제 내용\n```", true],
    ["# \n\n", false],
    ["  \n\t", false],
    ["# **_~~\n\n---", false],
    ["[]()", false],
    ["![](url", false],
    ["```\n```", false],
  ])("classifies %j as %s", (markdown, expected) => {
    expect(isMeaningfulThoughtMarkdown(markdown)).toBe(expected);
  });
});