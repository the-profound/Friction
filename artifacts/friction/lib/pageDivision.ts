const PAGE_DIVIDER = "---";

export interface PageBlock {
  pageIndex: number;
  content: string;
  charCount: number;
}

export interface DivisionWarning {
  pageIndex: number;
  paragraphIndex: number;
  reason: string;
}

export function splitContentToPages(markdownContent: string): PageBlock[] {
  const rawPages = markdownContent.split(new RegExp(`^${PAGE_DIVIDER}$`, "m"));
  return rawPages.map((content, i) => ({
    pageIndex: i,
    content: content.trim(),
    charCount: content.trim().length,
  }));
}

export function mergePagesTocontent(pages: PageBlock[]): string {
  return pages.map((p) => p.content).join(`\n${PAGE_DIVIDER}\n`);
}

export function insertDividerAtPosition(
  content: string,
  paragraphBoundaryIndex: number,
): string {
  const paragraphs = content.split("\n\n");
  if (paragraphBoundaryIndex < 0 || paragraphBoundaryIndex >= paragraphs.length) {
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

export function validatePages(pages: PageBlock[], maxCharPerPage: number): DivisionWarning[] {
  const warnings: DivisionWarning[] = [];
  for (const page of pages) {
    const paragraphs = page.content.split("\n\n");
    for (let pi = 0; pi < paragraphs.length; pi++) {
      if (paragraphs[pi].length > maxCharPerPage) {
        warnings.push({
          pageIndex: page.pageIndex,
          paragraphIndex: pi,
          reason: "단일 문단이 페이지 안전 영역을 초과합니다. 문단을 나눠주세요.",
        });
      }
    }
  }
  return warnings;
}

export function countPages(content: string): number {
  return splitContentToPages(content).length;
}
