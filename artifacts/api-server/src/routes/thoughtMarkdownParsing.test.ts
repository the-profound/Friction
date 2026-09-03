import { describe, expect, it } from "vitest";
import { formatThoughtMarkdown, parseThoughtMarkdown } from "./thoughts";

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

  it("round-trips a reviewed multi-line title and body back through thought Markdown", () => {
    const markdown = formatThoughtMarkdown(
      "첫 제목\n둘째 제목",
      "검토에서 고친 본문\n\n다음 문단",
    );

    expect(markdown).toBe(
      "# 첫 제목  \n둘째 제목\n\n검토에서 고친 본문\n\n다음 문단",
    );
    expect(parseThoughtMarkdown(markdown)).toEqual({
      title: "첫 제목\n둘째 제목",
      body: "검토에서 고친 본문\n\n다음 문단",
    });
  });

  it("preserves leading body newlines across reverse-promotion and promotion", () => {
    const markdown = formatThoughtMarkdown("제목", "\n본문");

    expect(markdown).toBe("# 제목\n\n\n본문");
    expect(parseThoughtMarkdown(markdown)).toEqual({
      title: "제목",
      body: "\n본문",
    });
  });

  it("round-trips literal Markdown title syntax and edge whitespace", () => {
    const title = "  *important* [label](url) ![image](src) \\\\  ";
    const markdown = formatThoughtMarkdown(title, "본문");

    expect(markdown).toMatch(/^# &#32;&#32;\\\*important\\\*/);
    expect(parseThoughtMarkdown(markdown)).toEqual({
      title,
      body: "본문",
    });
  });

  it("does not decode literal numeric-entity-looking title text", () => {
    for (const title of ["&#35;", "&#999999999999999999999;", "&#not-a-number;"]) {
      const markdown = formatThoughtMarkdown(title, "본문");
      expect(parseThoughtMarkdown(markdown)).toEqual({ title, body: "본문" });
    }
  });
});