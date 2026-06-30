import { describe, it, expect } from "vitest";
import { parseMemoPages, serializeMemoPages } from "../memoPages";

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
