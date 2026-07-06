import { describe, it, expect } from "vitest";
import {
  splitContentToPages,
  isImagePara,
  simulateGreedyJobs,
  runGreedy,
} from "../pageDivision";

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

describe("isImagePara", () => {
  it("recognizes a single-line image markdown paragraph", () => {
    expect(isImagePara("![](https://example.com/a.jpg)")).toBe(true);
    expect(isImagePara("![alt text](https://example.com/a.jpg)")).toBe(true);
  });

  it("rejects paragraphs that merely contain an image alongside text", () => {
    expect(isImagePara("사진: ![](https://example.com/a.jpg)")).toBe(false);
    expect(isImagePara("![](https://example.com/a.jpg) 설명")).toBe(false);
  });

  it("rejects plain text and headings", () => {
    expect(isImagePara("일반 텍스트")).toBe(false);
    expect(isImagePara("### 소제목")).toBe(false);
  });
});

describe("image isolation in the greedy division engine", () => {
  const threshold = 100;

  it("keeps a photo on its own page even when it would fit alongside neighbours", () => {
    const paragraphs = [
      "짧은 문단 하나",
      "![](https://example.com/a.jpg)",
      "다음 문단도 짧다",
    ];
    const paraHeights = { 0: 20, 1: 10, 2: 20 };

    const jobs = simulateGreedyJobs(paragraphs, paraHeights, threshold);
    expect(jobs).toHaveLength(0);

    const pages = runGreedy(paragraphs, paraHeights, {}, threshold);
    expect(pages).toEqual([
      "짧은 문단 하나",
      "![](https://example.com/a.jpg)",
      "다음 문단도 짧다",
    ]);
  });

  it("isolates two photos inserted back-to-back onto separate pages", () => {
    const paragraphs = [
      "![](https://example.com/a.jpg)",
      "![](https://example.com/b.jpg)",
    ];
    const paraHeights = { 0: 10, 1: 10 };

    const pages = runGreedy(paragraphs, paraHeights, {}, threshold);
    expect(pages).toEqual([
      "![](https://example.com/a.jpg)",
      "![](https://example.com/b.jpg)",
    ]);
  });

  it("does not break a photo boundary during overflow-driven paragraph splitting", () => {
    const longPara = Array.from({ length: 40 }, (_, i) => `단어${i}`).join(" ");
    const paragraphs = ["앞 문단", "![](https://example.com/a.jpg)", longPara];
    const paraHeights = { 0: 20, 1: 10, 2: 200 };

    const jobs = simulateGreedyJobs(paragraphs, paraHeights, threshold);
    // BS job should only ever target the overflowing text paragraph (idx 2),
    // never the image paragraph (idx 1).
    expect(jobs.every((j) => j.paraIdx === 2)).toBe(true);
  });
});
