import { MarkdownPolicy } from "./policies";

const PAGE_DIVIDER = MarkdownPolicy.PAGE_DIVIDER;
const HEADING_REGEX = /^#{1,6}\s+/;
const DEFAULT_MAX_CHARS_PER_PAGE = 2000;
const SAFETY_ZONE_RATIO = 0.9;

export interface PageBlock {
  pageIndex: number;
  content: string;
  charCount: number;
}

export type WarningLevel = "yellow" | "red";

export interface DivisionWarning {
  pageIndex: number;
  paragraphIndex: number;
  level: WarningLevel;
  reason: string;
}

export interface DivisionValidation {
  isValid: boolean;
  warnings: DivisionWarning[];
  hasRedWarnings: boolean;
  pageCount: number;
}

export function splitContentToPages(markdownContent: string): PageBlock[] {
  const rawPages = markdownContent.split(new RegExp(`^${PAGE_DIVIDER}$`, "m"));
  return rawPages.map((content, i) => ({
    pageIndex: i,
    content: content.trim(),
    charCount: content.trim().length,
  }));
}

export function mergePagesToContent(pages: PageBlock[]): string {
  return pages.map((p) => p.content).join(`\n${PAGE_DIVIDER}\n`);
}

export function autoSplitByHeadings(content: string): string {
  const lines = content.split("\n");
  const result: string[] = [];
  let isFirstHeading = true;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (HEADING_REGEX.test(line) && !isFirstHeading) {
      const prevLine = result[result.length - 1];
      if (prevLine !== PAGE_DIVIDER && prevLine?.trim() !== "") {
        result.push(PAGE_DIVIDER);
      }
    }
    if (HEADING_REGEX.test(line)) {
      isFirstHeading = false;
    }
    result.push(line);
  }

  return result.join("\n");
}

export function insertDividerAtPosition(
  content: string,
  paragraphBoundaryIndex: number,
): string {
  const paragraphs = content.split("\n\n");
  if (paragraphBoundaryIndex < 0 || paragraphBoundaryIndex >= paragraphs.length - 1) {
    return content;
  }
  const before = paragraphs.slice(0, paragraphBoundaryIndex + 1).join("\n\n");
  const after = paragraphs.slice(paragraphBoundaryIndex + 1).join("\n\n");
  return `${before}\n${PAGE_DIVIDER}\n${after}`;
}

export function removeDividerAtPageIndex(content: string, pageBreakIndex: number): string {
  const parts = content.split(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "m"));
  if (pageBreakIndex < 0 || pageBreakIndex >= parts.length - 1) return content;
  parts[pageBreakIndex] = parts[pageBreakIndex] + "\n\n" + parts[pageBreakIndex + 1];
  parts.splice(pageBreakIndex + 1, 1);
  return parts.join(`\n${PAGE_DIVIDER}\n`);
}

export function validateDivision(
  pages: PageBlock[],
  maxCharPerPage: number = DEFAULT_MAX_CHARS_PER_PAGE,
): DivisionValidation {
  const warnings: DivisionWarning[] = [];
  const safetyLimit = Math.floor(maxCharPerPage * SAFETY_ZONE_RATIO);

  for (const page of pages) {
    if (!page.content.trim()) {
      warnings.push({
        pageIndex: page.pageIndex,
        paragraphIndex: 0,
        level: "red",
        reason: "빈 페이지입니다. 내용을 채우거나 삭제해주세요.",
      });
      continue;
    }

    if (page.charCount > maxCharPerPage) {
      warnings.push({
        pageIndex: page.pageIndex,
        paragraphIndex: -1,
        level: "red",
        reason: "페이지가 최대 글자 수를 초과합니다. 페이지를 나눠주세요.",
      });
    } else if (page.charCount > safetyLimit) {
      warnings.push({
        pageIndex: page.pageIndex,
        paragraphIndex: -1,
        level: "yellow",
        reason: "페이지가 안전 영역을 초과하고 있습니다.",
      });
    }

    const paragraphs = page.content.split("\n\n");
    for (let pi = 0; pi < paragraphs.length; pi++) {
      if (paragraphs[pi].length > maxCharPerPage) {
        warnings.push({
          pageIndex: page.pageIndex,
          paragraphIndex: pi,
          level: "red",
          reason: "단일 문단이 페이지 최대 크기를 초과합니다. 문단을 나눠주세요.",
        });
      }
    }
  }

  const hasRedWarnings = warnings.some((w) => w.level === "red");

  return {
    isValid: !hasRedWarnings,
    warnings,
    hasRedWarnings,
    pageCount: pages.length,
  };
}

export function validatePages(pages: PageBlock[], maxCharPerPage: number = DEFAULT_MAX_CHARS_PER_PAGE): DivisionWarning[] {
  return validateDivision(pages, maxCharPerPage).warnings;
}

export function countPages(content: string): number {
  return splitContentToPages(content).length;
}

export function derivePages(content: string): string[] {
  return splitContentToPages(content)
    .map((p) => p.content)
    .filter((c) => c.length > 0);
}

export const splitPages = splitContentToPages;
export const mergePages = mergePagesToContent;
