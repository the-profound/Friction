import { describe, it, expect } from "vitest";
import {
  splitContentToPages,
  mergePagesToContent,
  isImagePara,
  isBlockquotePara,
  simulateGreedyJobs,
  runGreedy,
  splitPageContentForDivision,
  splitPageContentsLosslessly,
} from "../pageDivision";
import {
  createEmptyParagraphMarker,
  preserveMarkdownBlankLinesForEditor,
  restoreEmptyParagraphMarkers,
  restoreLeakedEmptyParagraphMarkers,
} from "../markdownBlankLines";
import { normalizePageDividersForMarkdownParser } from "../pageDividerMarkdown";
import { markdownToHtml } from "../markdownRenderer";
import { marked } from "marked";
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
    expect(pages[1].content).toBe("\n두 번째 페이지 내용");
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

  it("keeps a divider after a paragraph as a page boundary, not a heading", () => {
    const content = "본문\n---\n다음 본문";
    const pages = splitContentToPages(content);

    expect(pages.map((page) => page.content)).toEqual(["본문", "다음 본문"]);
  });

  it("removes repeated leading and trailing boundary dividers without removing middle empty pages", () => {
    const content = "---\n\n---\n첫 페이지\n---\n\n---\n둘째 페이지\n---\n\n---";
    const pages = splitContentToPages(content);

    expect(pages.map((page) => page.content)).toEqual(["첫 페이지", "", "둘째 페이지"]);
  });

  it("round-trips authored headings next to page dividers", () => {
    const pages = splitContentToPages("# 실제 제목\n---\n본문");

    expect(mergePagesToContent(pages)).toBe("# 실제 제목\n---\n본문");
  });

  it("preserves multiple authored blank lines inside every page", () => {
    const content = "첫 문단\n\n\n\n둘째 문단\n---\n목록:\n\n\n- 하나\n\n\n\n> 인용";
    const pages = splitContentToPages(content);

    expect(pages.map((page) => page.content)).toEqual([
      "첫 문단\n\n\n\n둘째 문단",
      "목록:\n\n\n- 하나\n\n\n\n> 인용",
    ]);
    expect(mergePagesToContent(pages)).toBe(content);
  });

  it("preserves additional blank lines adjacent to page dividers", () => {
    for (const newlineCount of [2, 3, 4, 6]) {
      const whitespace = "\n".repeat(newlineCount);
      const content = `첫 페이지${whitespace}---${whitespace}둘째 페이지`;
      const pages = splitContentToPages(content);

      expect(pages).toHaveLength(2);
      expect(pages[0].content).toBe(`첫 페이지${"\n".repeat(newlineCount - 1)}`);
      expect(pages[1].content).toBe(`${"\n".repeat(newlineCount - 1)}둘째 페이지`);
      expect(mergePagesToContent(pages)).toBe(content);
    }
  });
});

describe("editor blank-line round trips", () => {
  it("turns each additional newline into an editor empty paragraph", () => {
    expect(preserveMarkdownBlankLinesForEditor("앞\n\n뒤")).toBe("앞\n\n뒤");
    expect(preserveMarkdownBlankLinesForEditor("앞\n\n\n뒤")).toBe(
      '앞\n\n<p data-friction-preserved-blank="true"></p>\n\n뒤',
    );
    expect(
      preserveMarkdownBlankLinesForEditor("앞\n\n\n\n뒤").match(
        /data-friction-preserved-blank/g,
      ),
    ).toHaveLength(2);
  });

  it("preserves authored blank paragraphs at the document boundaries", () => {
    expect(preserveMarkdownBlankLinesForEditor("\n\n\n본문\n\n")).toBe(
      '<p data-friction-preserved-blank="true"></p>\n\n본문',
    );
  });

  it("preserves three-or-more terminal newlines as authored empty paragraphs", () => {
    expect(preserveMarkdownBlankLinesForEditor("본문\n\n\n")).toBe(
      '본문\n\n<p data-friction-preserved-blank="true"></p>',
    );
    expect(
      preserveMarkdownBlankLinesForEditor("본문\n\n\n\n").match(
        /data-friction-preserved-blank/g,
      ),
    ).toHaveLength(2);
  });

  it("restores empty editor paragraphs to their exact newline count", () => {
    const marker = createEmptyParagraphMarker("앞뒤");
    expect(
      restoreEmptyParagraphMarkers(
        `앞\n\n${marker}\n\n뒤`,
        marker,
      ),
    ).toBe("앞\n\n\n뒤");
    expect(
      restoreEmptyParagraphMarkers(
        `앞\n\n${marker}\n\n${marker}\n\n뒤`,
        marker,
      ),
    ).toBe("앞\n\n\n\n뒤");
    expect(restoreEmptyParagraphMarkers(`끝\n\n${marker}`, marker)).toBe(
      "끝\n\n\n",
    );
    expect(
      restoreEmptyParagraphMarkers(`끝\n\n${marker}\n\n${marker}`, marker),
    ).toBe("끝\n\n\n\n");
    expect(restoreEmptyParagraphMarkers(`${marker}\n\n시작`, marker)).toBe(
      "\n\n\n시작",
    );
    expect(
      restoreEmptyParagraphMarkers(`${marker}\n\n${marker}\n\n시작`, marker),
    ).toBe("\n\n\n\n시작");
  });

  it("never mistakes authored marker-like text for an empty paragraph", () => {
    const authored = "앞\n\nFRICTIONEMPTYBLANKPARAGRAPH\n\n뒤";
    const marker = createEmptyParagraphMarker(authored);

    expect(marker).not.toBe("FRICTIONEMPTYBLANKPARAGRAPH");
    expect(restoreEmptyParagraphMarkers(authored, marker)).toBe(authored);
  });

  it("repairs leaked standalone marker-family lines at every boundary", () => {
    expect(
      restoreLeakedEmptyParagraphMarkers(
        "FRICTIONEMPTYBLANKPARAGRAPH\n\n시작"
        + "\n\nFRICTIONEMPTYBLANKPARAGRAPHX\n\n중간"
        + "\n\nFRICTIONEMPTYBLANKPARAGRAPHXX",
      ),
    ).toBe("\n\n\n시작\n\n\n중간\n\n\n");
    expect(
      restoreLeakedEmptyParagraphMarkers(
        "문장 속 FRICTIONEMPTYBLANKPARAGRAPH 표식은 그대로",
      ),
    ).toBe("문장 속 FRICTIONEMPTYBLANKPARAGRAPH 표식은 그대로");
  });
});

describe("division preserves authored blank lines", () => {
  it("keeps two-or-more consecutive blank lines through a no-op engine round trip", () => {
    for (const content of ["앞\n\n\n뒤", "앞\n\n\n\n뒤"]) {
      const paragraphs = splitPageContentForDivision(content);
      const heights = Object.fromEntries(paragraphs.map((_, index) => [index, 10]));

      expect(runGreedy(paragraphs, heights, {}, 1000)).toEqual([content]);
    }
  });

  it("keeps formatting and whitespace in heading, list, and quote documents", () => {
    for (const content of [
      "### 제목\n\n\n본문",
      "- 목록\n\n\n다음 문단",
      "> 인용\n\n\n다음 문단",
    ]) {
      const paragraphs = splitPageContentForDivision(content);
      const heights = Object.fromEntries(paragraphs.map((_, index) => [index, 10]));

      expect(runGreedy(paragraphs, heights, {}, 1000)).toEqual([content]);
    }
  });

  it("keeps image markdown and surrounding authored whitespace across stored pages", () => {
    const content =
      "사진 설명\n\n\n![](https://example.com/a.jpg)\n---\n다음 사진\n\n\n\n![둘](https://example.com/b.jpg)";

    expect(mergePagesToContent(splitContentToPages(content))).toBe(content);
  });

  it("closes and reopens emphasis split across automatic page boundaries", () => {
    const paragraph = "**첫째 둘째 셋째 넷째**";
    const pages = runGreedy(
      [paragraph],
      { 0: 200 },
      { 0: [
        { wordOffset: 0, wordCount: 2 },
        { wordOffset: 2, wordCount: 2 },
      ] },
      100,
    );

    expect(pages).toEqual(["**첫째 둘째**", "**셋째 넷째**"]);
    expect(pages.every((page) => {
      const html = markdownToHtml(page);
      return html.includes("<strong>") && !html.includes("**");
    })).toBe(true);
  });

  it.each([
    ["_첫째 둘째 셋째 넷째 다섯째 여섯째_", "<em>"],
    ["***첫째 둘째 셋째 넷째 다섯째 여섯째***", "<strong><em>"],
  ])("keeps %s valid across three automatic pages", (paragraph, expectedTag) => {
    const pages = runGreedy(
      [paragraph],
      { 0: 300 },
      { 0: [
        { wordOffset: 0, wordCount: 2 },
        { wordOffset: 2, wordCount: 2 },
        { wordOffset: 4, wordCount: 2 },
      ] },
      100,
    );

    expect(pages).toHaveLength(3);
    expect(pages.every((page) => {
      const html = markdownToHtml(page);
      return html.includes(expectedTag);
    })).toBe(true);
  });

  it.each([
    "foo_bar baz_qux",
    "version_1 continues_here",
    "escaped\\_underscore next",
    "https://example.com/path_with_name next_page",
  ])("does not mutate literal underscores when splitting %s", (paragraph) => {
    const pages = runGreedy(
      [paragraph],
      { 0: 200 },
      { 0: [
        { wordOffset: 0, wordCount: 1 },
        { wordOffset: 1, wordCount: 1 },
      ] },
      100,
    );

    expect(pages).toEqual(paragraph.split(" "));
  });

  it.each([
    ["2 * 2 more", 2],
    ["escaped\\*asterisk next", 1],
    ["stars *** separator", 2],
  ] as const)("does not mutate literal asterisks when splitting %s", (paragraph, firstCount) => {
    const words = paragraph.split(" ");
    const pages = runGreedy(
      [paragraph],
      { 0: 200 },
      { 0: [
        { wordOffset: 0, wordCount: firstCount },
        { wordOffset: firstCount, wordCount: words.length - firstCount },
      ] },
      100,
    );

    expect(pages).toEqual([
      words.slice(0, firstCount).join(" "),
      words.slice(firstCount).join(" "),
    ]);
  });

  it("preserves nested emphasis across an automatic page boundary", () => {
    const paragraph = "**굵게 _기울임 둘째_ 다시굵게**";
    const pages = runGreedy(
      [paragraph],
      { 0: 200 },
      { 0: [
        { wordOffset: 0, wordCount: 2 },
        { wordOffset: 2, wordCount: 2 },
      ] },
      100,
    );

    expect(pages).toEqual([
      "**굵게 _기울임_**",
      "**_둘째_ 다시굵게**",
    ]);
    expect(pages.every((page) => {
      const html = markdownToHtml(page);
      return html.includes("<strong>") && html.includes("<em>");
    })).toBe(true);
  });

  it("does not add formatting to an unmatched opening delimiter", () => {
    const paragraph = "*미완성 일반 문장";
    const pages = runGreedy(
      [paragraph],
      { 0: 200 },
      { 0: [
        { wordOffset: 0, wordCount: 1 },
        { wordOffset: 1, wordCount: 2 },
      ] },
      100,
    );

    expect(pages).toEqual(["*미완성", "일반 문장"]);
  });

  it.each([
    ["**굵게 *함께 둘째***", true],
    ["***함께 둘째* 굵게**", false],
  ] as const)("preserves combined asterisk closers across a page boundary: %s", (paragraph, secondPageItalic) => {
    const pages = runGreedy(
      [paragraph],
      { 0: 200 },
      { 0: [
        { wordOffset: 0, wordCount: 2 },
        { wordOffset: 2, wordCount: 1 },
      ] },
      100,
    );

    expect(pages).toHaveLength(2);
    const htmlPages = pages.map((page) => markdownToHtml(page));
    expect(htmlPages[0]).toContain("<strong>");
    expect(htmlPages[0]).toContain("<em>");
    expect(htmlPages[1]).toContain("<strong>");
    expect(htmlPages[1].includes("<em>")).toBe(secondPageItalic);
    expect(htmlPages.every((html) => !html.includes("***"))).toBe(true);
  });

  it("preserves bold nested inside italic when a combined opener crosses pages", () => {
    const pages = runGreedy(
      ["***함께 둘째** 기울임*"],
      { 0: 200 },
      { 0: [
        { wordOffset: 0, wordCount: 2 },
        { wordOffset: 2, wordCount: 1 },
      ] },
      100,
    );
    const htmlPages = pages.map((page) => markdownToHtml(page));

    expect(htmlPages[0]).toContain("<strong>");
    expect(htmlPages[0]).toContain("<em>");
    expect(htmlPages[1]).not.toContain("<strong>");
    expect(htmlPages[1]).toContain("<em>");
    expect(htmlPages.every((html) => !html.includes("*"))).toBe(true);
  });
});

describe("page divider parser boundary", () => {
  it("protects paragraph-adjacent dividers from Setext parsing", () => {
    const normalized = normalizePageDividersForMarkdownParser("본문\n---\n다음 본문");

    expect(normalized).toBe("본문\n\n---\n\n다음 본문");
    expect(marked.parse(normalized)).toContain("<hr>");
  });

  it("preserves ATX headings and keeps the native-style parser on hr nodes", () => {
    const markdown = "# 실제 제목\n---\n**본문 서식**";
    const html = markdownToHtml(markdown);

    expect(html).toContain("<h1>실제 제목</h1>");
    expect(html).toContain("<hr>");
    expect(html).toContain("<strong>본문 서식</strong>");
    expect(html).not.toContain("<h2>#");
  });

  it("handles leading, trailing, and consecutive dividers without changing their meaning", () => {
    const markdown = "---\n본문\n---\n\n---\n다음\n---";
    const normalized = normalizePageDividersForMarkdownParser(markdown);
    const html = marked.parse(normalized);

    expect(normalized).toContain("\n---\n");
    expect((normalized.match(/---/g) ?? []).length).toBe(4);
    expect(typeof html === "string" ? html.match(/<hr>/g) : []).toHaveLength(4);
  });

  it("canonicalizes space- and tab-padded dividers for web and native-style parsers", () => {
    const markdown = "첫 페이지\n  --- \t\n둘째 페이지\n\t---\t\n셋째 페이지";
    const normalized = normalizePageDividersForMarkdownParser(markdown);
    const webHtml = marked.parse(normalized);
    const nativeStyleHtml = markdownToHtml(markdown);

    expect(normalized).toBe(
      "첫 페이지\n\n---\n\n둘째 페이지\n\n---\n\n셋째 페이지",
    );
    expect(typeof webHtml === "string" ? webHtml.match(/<hr>/g) : []).toHaveLength(2);
    expect(nativeStyleHtml.match(/<hr>/g)).toHaveLength(2);
    expect(nativeStyleHtml).not.toContain("---");
    expect(splitContentToPages(markdown).map((page) => page.content)).toEqual([
      "첫 페이지",
      "둘째 페이지",
      "셋째 페이지",
    ]);
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
