import { describe, it, expect } from "vitest";
import { splitContentToPages } from "../pageDivision";

describe("splitContentToPages", () => {
  it("splits content on --- dividers", () => {
    const content = "page one\n---\npage two";
    const pages = splitContentToPages(content);
    expect(pages).toHaveLength(2);
    expect(pages[0].content).toBe("page one");
    expect(pages[1].content).toBe("page two");
  });

  it("assigns correct pageIndex and charCount", () => {
    const content = "hello\n---\nworld";
    const pages = splitContentToPages(content);
    expect(pages[0].pageIndex).toBe(0);
    expect(pages[0].charCount).toBe(5);
    expect(pages[1].pageIndex).toBe(1);
    expect(pages[1].charCount).toBe(5);
  });

  it("trims trailing --- so no ghost empty page is produced", () => {
    const content = "page one\n---\npage two\n---\n\n";
    const pages = splitContentToPages(content);
    expect(pages).toHaveLength(2);
    expect(pages.every((p) => p.content.length > 0)).toBe(true);
  });

  it("trims leading --- so no ghost empty page is produced", () => {
    const content = "---\n\npage one\n---\npage two";
    const pages = splitContentToPages(content);
    expect(pages).toHaveLength(2);
    expect(pages[0].content).toBe("page one");
  });

  it("TipTap horizontalRule trailing serialisation --- does not create ghost page", () => {
    const content = "첫 번째 페이지 내용\n---\n\n두 번째 페이지 내용\n---\n\n";
    const pages = splitContentToPages(content);
    expect(pages).toHaveLength(2);
    expect(pages[0].content).toBe("첫 번째 페이지 내용");
    expect(pages[1].content).toBe("두 번째 페이지 내용");
    expect(pages.every((p) => p.charCount > 0)).toBe(true);
  });

  it("still detects a genuine mid-content empty page", () => {
    const content = "page one\n---\n\n---\npage three";
    const pages = splitContentToPages(content);
    expect(pages).toHaveLength(3);
    expect(pages[1].content).toBe("");
    expect(pages[1].charCount).toBe(0);
  });

  it("handles single page with no dividers", () => {
    const content = "just one page";
    const pages = splitContentToPages(content);
    expect(pages).toHaveLength(1);
    expect(pages[0].content).toBe("just one page");
    expect(pages[0].charCount).toBe(13);
  });

  it("handles empty content", () => {
    const pages = splitContentToPages("");
    expect(pages).toHaveLength(1);
    expect(pages[0].content).toBe("");
    expect(pages[0].charCount).toBe(0);
  });

  it("handles content with only whitespace", () => {
    const pages = splitContentToPages("   \n\n  ");
    expect(pages).toHaveLength(1);
    expect(pages[0].content).toBe("");
    expect(pages[0].charCount).toBe(0);
  });
});
