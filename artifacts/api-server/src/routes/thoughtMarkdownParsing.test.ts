import { describe, expect, it } from "vitest";
import { parseThoughtMarkdown } from "./thoughts";

describe("thought promotion Markdown parsing", () => {
  it("keeps consecutive hard-break lines in the title and separates the actual body", () => {
    expect(parseThoughtMarkdown(
      "# **첫 제목**  \n둘째 <u>제목</u>  \n셋째 제목\n\n실제 본문",
    )).toEqual({
      title: "첫 제목\n둘째 제목\n셋째 제목",
      body: "실제 본문",
    });
  });

  it("does not promote an ordinary next line into the title without a hard break", () => {
    expect(parseThoughtMarkdown("# 제목\n실제 본문")).toEqual({
      title: "제목",
      body: "실제 본문",
    });
  });
});