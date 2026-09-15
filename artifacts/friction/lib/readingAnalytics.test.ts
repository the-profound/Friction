import { describe, expect, it } from "vitest";
import {
  formatReadingThoughtQuote,
  getReadingThoughtMemoLength,
} from "./thoughtInlineEditor";

describe("reading memo analytics length", () => {
  it("counts a direct memo after normalization and trim", () => {
    expect(getReadingThoughtMemoLength("  여러 줄\r\n한글 메모  ")).toBe(10);
  });

  it("excludes the shared leading quote and source", () => {
    const quote = formatReadingThoughtQuote("인용 첫 줄\n인용 둘째 줄", "작가, 제목, 2면");
    expect(getReadingThoughtMemoLength(`${quote}\n\n사용자 메모`)).toBe(6);
  });

  it("reports zero for quote-only and source-only saves", () => {
    expect(getReadingThoughtMemoLength(formatReadingThoughtQuote("인용", "작가, 제목, 1면"))).toBe(0);
    expect(getReadingThoughtMemoLength("> 인용")).toBe(0);
  });

  it("does not strip user text that merely contains later blockquotes", () => {
    expect(getReadingThoughtMemoLength("내 생각\n\n> 이어 쓴 인용")).toBe(15);
  });
});