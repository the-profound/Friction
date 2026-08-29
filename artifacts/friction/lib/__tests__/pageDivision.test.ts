import { describe, it, expect } from "vitest";
import {
  splitContentToPages,
  isImagePara,
  isBlockquotePara,
  simulateGreedyJobs,
  runGreedy,
} from "../pageDivision";
import { computePageGeometry, getPageTextContentHeight } from "../pageGeometry";

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

describe("shared paragraph spacing at page boundaries", () => {
  it("keeps consecutive and empty paragraph measurements on the 0.6em contract", () => {
    const lineHeight = 18;
    const paragraphGap = 6;
    const oneLineParagraphHeight = lineHeight + paragraphGap;
    const paragraphs = ["첫 문단", "", "페이지 경계 직전 문단"];
    const paraHeights = {
      0: oneLineParagraphHeight,
      1: paragraphGap,
      2: oneLineParagraphHeight,
    };
    const threshold =
      oneLineParagraphHeight + paragraphGap + oneLineParagraphHeight - 1;

    expect(runGreedy(paragraphs, paraHeights, {}, threshold)).toEqual([
      "첫 문단\n\n",
      "페이지 경계 직전 문단",
    ]);
  });
});

describe("isBlockquotePara", () => {
  it("recognizes lines starting with '> '", () => {
    expect(isBlockquotePara("> 인용 텍스트")).toBe(true);
    expect(isBlockquotePara(">  이중 공백")).toBe(true);
  });

  it("rejects plain text and headings", () => {
    expect(isBlockquotePara("일반 단락")).toBe(false);
    expect(isBlockquotePara("### 소제목")).toBe(false);
    expect(isBlockquotePara(">단락 없이 붙은 경우")).toBe(false);
  });
});

describe("blockquote handling in the greedy division engine", () => {
  const threshold = 100;

  it("(a) 일반 단락 뒤에 blockquote가 오면 페이지가 분리된다", () => {
    const paragraphs = ["일반 단락 텍스트", "> 인용 텍스트"];
    const paraHeights = { 0: 30, 1: 30 };

    const jobs = simulateGreedyJobs(paragraphs, paraHeights, threshold);
    expect(jobs).toHaveLength(0);

    const pages = runGreedy(paragraphs, paraHeights, {}, threshold);
    expect(pages).toEqual(["일반 단락 텍스트", "> 인용 텍스트"]);
  });

  it("(b) 짧은 blockquote는 단독으로 한 페이지를 차지한다", () => {
    const paragraphs = ["> 짧은 인용문입니다"];
    const paraHeights = { 0: 20 };

    const jobs = simulateGreedyJobs(paragraphs, paraHeights, threshold);
    expect(jobs).toHaveLength(0);

    const pages = runGreedy(paragraphs, paraHeights, {}, threshold);
    expect(pages).toEqual(["> 짧은 인용문입니다"]);
  });

  it("(c) 긴 blockquote는 BS 분할되며 각 조각이 '> ' prefix를 유지한다", () => {
    const words = Array.from({ length: 20 }, (_, i) => `단어${i}`);
    const blockquotePara = "> " + words.join(" ");
    const paragraphs = [blockquotePara];
    const paraHeights = { 0: 200 };

    const jobs = simulateGreedyJobs(paragraphs, paraHeights, threshold);
    expect(jobs).toHaveLength(1);
    expect(jobs[0].paraIdx).toBe(0);
    expect(jobs[0].allWords).toEqual(words);

    const splitResults = {
      0: [
        { wordOffset: 0, wordCount: 10 },
        { wordOffset: 10, wordCount: 10 },
      ],
    };
    const pages = runGreedy(paragraphs, paraHeights, splitResults, threshold);
    expect(pages).toHaveLength(2);
    expect(pages[0]).toMatch(/^> /);
    expect(pages[1]).toMatch(/^> /);
    expect(pages[0]).toBe("> " + words.slice(0, 10).join(" "));
    expect(pages[1]).toBe("> " + words.slice(10).join(" "));
  });
});

describe("page-frame capacity boundaries", () => {
  it("keeps a page that exactly fills the shared reader capacity intact", () => {
    const layout = computePageGeometry(300, {
      aspectRatio: 5 / 8,
      paddingXCqi: 6,
      paddingYCqi: 15,
    });
    const threshold = getPageTextContentHeight(layout, 34 + 33);
    const paragraphs = ["첫 문단", "둘째 문단"];
    const paraHeights = { 0: threshold / 2, 1: threshold / 2 };

    expect(runGreedy(paragraphs, paraHeights, {}, threshold)).toEqual([
      "첫 문단\n\n둘째 문단",
    ]);
  });

  it("starts a new page as soon as shared reader capacity is exceeded", () => {
    const layout = computePageGeometry(300, {
      aspectRatio: 5 / 8,
      paddingXCqi: 6,
      paddingYCqi: 15,
    });
    const threshold = getPageTextContentHeight(layout, 34 + 33);
    const paragraphs = ["첫 문단", "둘째 문단"];
    const paraHeights = { 0: threshold / 2, 1: threshold / 2 + 0.01 };

    expect(runGreedy(paragraphs, paraHeights, {}, threshold)).toEqual([
      "첫 문단",
      "둘째 문단",
    ]);
  });
});
