import { describe, it, expect } from "vitest";
import { parseMarkdownBlocks } from "../markdownParser";

describe("parseMarkdownBlocks — non-string guard", () => {
  it("undefined를 전달해도 크래시 없이 빈 배열을 반환한다", () => {
    expect(parseMarkdownBlocks(undefined as unknown as string)).toEqual([]);
  });

  it("null을 전달해도 크래시 없이 빈 배열을 반환한다", () => {
    expect(parseMarkdownBlocks(null as unknown as string)).toEqual([]);
  });

  it("숫자를 전달해도 크래시 없이 빈 배열을 반환한다", () => {
    expect(parseMarkdownBlocks(42 as unknown as string)).toEqual([]);
  });

  it("객체를 전달해도 크래시 없이 빈 배열을 반환한다", () => {
    expect(parseMarkdownBlocks({ content: "텍스트" } as unknown as string)).toEqual([]);
  });

  it("빈 문자열은 빈 배열을 반환한다", () => {
    expect(parseMarkdownBlocks("")).toEqual([]);
  });

  it("공백만 있는 문자열은 빈 배열을 반환한다", () => {
    expect(parseMarkdownBlocks("   \n  ")).toEqual([]);
  });
});

describe("parseMarkdownBlocks — 정상 파싱", () => {
  it("일반 문단을 파싱한다", () => {
    const blocks = parseMarkdownBlocks("안녕하세요");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
    expect(blocks[0].rawText).toBe("안녕하세요");
  });

  it("h1 제목을 파싱한다", () => {
    const blocks = parseMarkdownBlocks("# 제목");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("h1");
  });

  it("h2 제목을 파싱한다", () => {
    const blocks = parseMarkdownBlocks("## 부제목");
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("h2");
  });

  it("블록쿼트를 파싱한다", () => {
    const blocks = parseMarkdownBlocks("> 인용문");
    expect(blocks.some((b) => b.type === "blockquote")).toBe(true);
  });

  it("내용 없는 빈 블록쿼트(>)는 blockquote 대신 빈 단락으로 치환한다", () => {
    const blocks = parseMarkdownBlocks(">");
    expect(blocks.some((b) => b.type === "blockquote")).toBe(false);
  });

  it("공백만 있는 블록쿼트(> )도 blockquote 로 만들지 않는다", () => {
    const blocks = parseMarkdownBlocks("> \n>\n");
    expect(blocks.some((b) => b.type === "blockquote")).toBe(false);
  });

  it("순서 없는 목록을 파싱한다", () => {
    const blocks = parseMarkdownBlocks("- 항목 1\n- 항목 2");
    const listItems = blocks.filter((b) => b.type === "ul_item");
    expect(listItems).toHaveLength(2);
  });

  it("순서 있는 목록을 파싱한다", () => {
    const blocks = parseMarkdownBlocks("1. 첫 번째\n2. 두 번째");
    const listItems = blocks.filter((b) => b.type === "ol_item");
    expect(listItems).toHaveLength(2);
    const first = listItems[0] as Extract<typeof listItems[0], { type: "ol_item" }>;
    expect(first.index).toBe(1);
  });

  it("볼드 텍스트가 인라인 토큰으로 파싱된다", () => {
    const blocks = parseMarkdownBlocks("**강조**");
    expect(blocks).toHaveLength(1);
    const boldToken = blocks[0].tokens.find((t) => t.kind === "bold");
    expect(boldToken).toBeDefined();
    expect(boldToken?.value).toBe("강조");
  });

  it("이탤릭 텍스트가 인라인 토큰으로 파싱된다", () => {
    const blocks = parseMarkdownBlocks("*기울임*");
    expect(blocks).toHaveLength(1);
    const italicToken = blocks[0].tokens.find((t) => t.kind === "italic");
    expect(italicToken).toBeDefined();
  });
});

describe("parseMarkdownBlocks — legacy page 시나리오 통합", () => {
  it("normalizePageItem으로 추출된 빈 문자열을 파싱해도 크래시 없이 빈 배열을 반환한다", () => {
    expect(parseMarkdownBlocks("")).toEqual([]);
  });

  it("legacy 객체에서 추출한 content 문자열을 정상 파싱한다", () => {
    const extractedContent = "이 글은 레거시 포맷으로 저장된 페이지입니다.";
    const blocks = parseMarkdownBlocks(extractedContent);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].type).toBe("paragraph");
  });
});
