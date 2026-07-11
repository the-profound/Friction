import { describe, it, expect } from "vitest";
import { parseMemoPages, serializeMemoPages, flattenMemoPages, buildReplyContent } from "../memoPages";

describe("parseMemoPages", () => {
  it("returns [''] for an empty string", () => {
    expect(parseMemoPages("")).toEqual([""]);
  });

  it("returns [''] for a falsy-ish value coerced as empty string", () => {
    expect(parseMemoPages("")).toEqual([""]);
  });

  it("parses a valid JSON string array", () => {
    const input = JSON.stringify(["page one", "page two", "page three"]);
    expect(parseMemoPages(input)).toEqual(["page one", "page two", "page three"]);
  });

  it("returns [''] when JSON array is empty", () => {
    expect(parseMemoPages(JSON.stringify([]))).toEqual([""]);
  });

  it("handles single-element JSON array", () => {
    const input = JSON.stringify(["only page"]);
    expect(parseMemoPages(input)).toEqual(["only page"]);
  });

  it("preserves empty-string pages inside the array", () => {
    const input = JSON.stringify(["page one", "", "page three"]);
    expect(parseMemoPages(input)).toEqual(["page one", "", "page three"]);
  });

  it("falls back to [content] for legacy plain-string content (no migration needed)", () => {
    const legacy = "이것은 레거시 메모 내용입니다.";
    expect(parseMemoPages(legacy)).toEqual([legacy]);
  });

  it("falls back to [content] for a JSON non-array value (e.g. an object)", () => {
    const notArray = JSON.stringify({ content: "something" });
    expect(parseMemoPages(notArray)).toEqual([notArray]);
  });

  it("falls back to [content] for a JSON array containing non-strings", () => {
    const mixed = JSON.stringify([1, 2, 3]);
    expect(parseMemoPages(mixed)).toEqual([mixed]);
  });

  it("falls back to [content] for malformed JSON", () => {
    const bad = '["page one", ';
    expect(parseMemoPages(bad)).toEqual([bad]);
  });

  it("falls back to [content] for a plain markdown string", () => {
    const markdown = "# 제목\n\n본문 내용입니다.";
    expect(parseMemoPages(markdown)).toEqual([markdown]);
  });
});

describe("serializeMemoPages", () => {
  it("serializes a single page to a JSON array string", () => {
    expect(serializeMemoPages(["page one"])).toBe('["page one"]');
  });

  it("serializes multiple pages", () => {
    const pages = ["first", "second", "third"];
    expect(serializeMemoPages(pages)).toBe(JSON.stringify(pages));
  });

  it("serializes empty pages array", () => {
    expect(serializeMemoPages([])).toBe("[]");
  });

  it("preserves empty-string pages", () => {
    expect(serializeMemoPages(["", "text", ""])).toBe('["","text",""]');
  });
});

describe("parseMemoPages / serializeMemoPages round-trip", () => {
  it("round-trips a single page", () => {
    const pages = ["단일 페이지 내용"];
    expect(parseMemoPages(serializeMemoPages(pages))).toEqual(pages);
  });

  it("round-trips multiple pages", () => {
    const pages = ["첫 번째 페이지", "두 번째 페이지", "세 번째 페이지"];
    expect(parseMemoPages(serializeMemoPages(pages))).toEqual(pages);
  });

  it("round-trips pages with markdown content", () => {
    const pages = ["# 제목\n\n본문 내용", "## 소제목\n\n더 많은 내용"];
    expect(parseMemoPages(serializeMemoPages(pages))).toEqual(pages);
  });

  it("round-trips pages with special characters", () => {
    const pages = ['페이지 "따옴표" 테스트', "백슬래시 \\ 테스트"];
    expect(parseMemoPages(serializeMemoPages(pages))).toEqual(pages);
  });
});

describe("flattenMemoPages", () => {
  it("joins multiple non-empty pages with a blank line", () => {
    expect(flattenMemoPages(["첫 페이지", "둘째 페이지"])).toBe("첫 페이지\n\n둘째 페이지");
  });

  it("skips empty/whitespace-only pages", () => {
    expect(flattenMemoPages(["첫 페이지", "   ", "", "둘째 페이지"])).toBe("첫 페이지\n\n둘째 페이지");
  });

  it("returns an empty string when all pages are empty", () => {
    expect(flattenMemoPages(["", "   "])).toBe("");
  });

  it("trims surrounding whitespace on each page", () => {
    expect(flattenMemoPages(["  내용  "])).toBe("내용");
  });
});

describe("buildReplyContent", () => {
  it("returns only the memo section when there are no answered cards", () => {
    const memo = serializeMemoPages(["메모 내용"]);
    expect(buildReplyContent(memo, [])).toBe("메모 내용");
  });

  it("returns only the question-card section when memo is empty", () => {
    const memo = serializeMemoPages([""]);
    const cards = [{ question: "질문 A", answer: "답변 A" }];
    expect(buildReplyContent(memo, cards)).toBe("> 질문 A\n\n답변 A");
  });

  it("combines memo above and answered cards below, separated by a blank line", () => {
    const memo = serializeMemoPages(["메모 내용"]);
    const cards = [{ question: "질문 A", answer: "답변 A" }];
    expect(buildReplyContent(memo, cards)).toBe("메모 내용\n\n> 질문 A\n\n답변 A");
  });

  it("separates multiple answered cards with a blank line, preserving order", () => {
    const memo = serializeMemoPages([""]);
    const cards = [
      { question: "질문 A", answer: "답변 A" },
      { question: "질문 B", answer: "답변 B" },
    ];
    expect(buildReplyContent(memo, cards)).toBe("> 질문 A\n\n답변 A\n\n> 질문 B\n\n답변 B");
  });

  it("excludes cards with empty/whitespace-only answers", () => {
    const memo = serializeMemoPages([""]);
    const cards = [
      { question: "질문 A", answer: "   " },
      { question: "질문 B", answer: "답변 B" },
    ];
    expect(buildReplyContent(memo, cards)).toBe("> 질문 B\n\n답변 B");
  });

  it("returns an empty string when both memo and cards are empty", () => {
    const memo = serializeMemoPages([""]);
    expect(buildReplyContent(memo, [])).toBe("");
  });

  it("flattens multi-page memo content before combining with cards", () => {
    const memo = serializeMemoPages(["첫 페이지", "둘째 페이지"]);
    const cards = [{ question: "질문 A", answer: "답변 A" }];
    expect(buildReplyContent(memo, cards)).toBe("첫 페이지\n\n둘째 페이지\n\n> 질문 A\n\n답변 A");
  });
});
