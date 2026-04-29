import { describe, it, expect } from "vitest";
import { normalizePageItem } from "../normalizePageItem";

describe("normalizePageItem", () => {
  it("string 값은 그대로 반환한다", () => {
    expect(normalizePageItem("hello world")).toBe("hello world");
  });

  it("빈 문자열도 그대로 반환한다", () => {
    expect(normalizePageItem("")).toBe("");
  });

  it("legacy 객체 포맷 { pageIndex, content, charCount }의 content를 추출한다", () => {
    const legacy = { pageIndex: 0, content: "본문 내용", charCount: 5 };
    expect(normalizePageItem(legacy)).toBe("본문 내용");
  });

  it("content가 빈 문자열인 legacy 객체도 빈 문자열을 반환한다", () => {
    const legacy = { pageIndex: 1, content: "", charCount: 0 };
    expect(normalizePageItem(legacy)).toBe("");
  });

  it("content 키가 없는 객체는 빈 문자열을 반환한다", () => {
    expect(normalizePageItem({ foo: "bar" })).toBe("");
  });

  it("content가 string이 아닌 객체는 빈 문자열을 반환한다", () => {
    expect(normalizePageItem({ content: 42 })).toBe("");
    expect(normalizePageItem({ content: null })).toBe("");
    expect(normalizePageItem({ content: true })).toBe("");
  });

  it("null은 빈 문자열을 반환한다", () => {
    expect(normalizePageItem(null)).toBe("");
  });

  it("undefined는 빈 문자열을 반환한다", () => {
    expect(normalizePageItem(undefined)).toBe("");
  });

  it("숫자는 빈 문자열을 반환한다", () => {
    expect(normalizePageItem(123)).toBe("");
  });

  it("배열은 빈 문자열을 반환한다", () => {
    expect(normalizePageItem(["a", "b"])).toBe("");
  });

  it("pages 배열에 혼합된 포맷이 있어도 map으로 정상 처리된다", () => {
    const pages: unknown[] = [
      "정상 문자열 페이지",
      { pageIndex: 1, content: "레거시 페이지", charCount: 5 },
      null,
      undefined,
      { someOtherKey: "no content" },
    ];
    const result = pages.map(normalizePageItem);
    expect(result).toEqual([
      "정상 문자열 페이지",
      "레거시 페이지",
      "",
      "",
      "",
    ]);
  });
});
