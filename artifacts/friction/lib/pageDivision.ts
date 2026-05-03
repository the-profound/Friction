import { MarkdownPolicy } from "./policies";

const PAGE_DIVIDER = MarkdownPolicy.PAGE_DIVIDER;
const HEADING_REGEX = /^#{1,6}\s+/;
const SECTION_BOUNDARY_RE = /^(#{1,3}\s)/;
const DEFAULT_MAX_CHARS_PER_PAGE = 2000;

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

  for (const page of pages) {
    if (!page.content.trim()) {
      warnings.push({
        pageIndex: page.pageIndex,
        paragraphIndex: 0,
        level: "red",
        reason: "빈 페이지입니다. 내용을 채우거나 삭제해주세요.",
      });
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

/**
 * 누적 블록 높이가 가용 높이를 처음 초과하는 블록의 인덱스를 반환한다.
 * 모든 블록이 가용 높이 안에 들어오면 -1.
 *
 * blockHeights[i] 는 i번째 블록 단독 측정값이며 marginBottom(=blockGap) 포함.
 *
 * tolerance: 한 줄 정도의 여유분(=bodyLineHeight)을 허용하기 위한 슬랙.
 *  cumulative > availableHeight + tolerance 일 때 비로소 초과로 판단한다.
 */
export function findOverflowBlockIndex(
  blockHeights: number[],
  availableHeight: number,
  tolerance: number = 0,
): number {
  let cumulative = 0;
  for (let i = 0; i < blockHeights.length; i++) {
    cumulative += blockHeights[i];
    if (cumulative > availableHeight + tolerance) return i;
  }
  return -1;
}

/**
 * 0..blockIndex-1 까지의 블록 높이 누적합을 반환한다.
 * findOverflowBlockIndex 가 가리키는 오버플로 블록 직전까지의 누적값을 얻을 때 쓴다.
 */
export function cumulativeHeightBefore(
  blockHeights: number[],
  blockIndex: number,
): number {
  let sum = 0;
  const limit = Math.min(blockIndex, blockHeights.length);
  for (let i = 0; i < limit; i++) sum += blockHeights[i];
  return sum;
}

export function derivePages(content: string): string[] {
  return splitContentToPages(content)
    .map((p) => p.content)
    .filter((c) => c.length > 0);
}

export const splitPages = splitContentToPages;
export const mergePages = mergePagesToContent;

// ─────────────────────────────────────────────────────────────────────────────
// Auto-Division Engine (greedy + word-level binary search)
//
// SSOT [PD] Logic — 페이지 분할 (Page Division) — invariants captured here:
//   1. 소제목(### 등) 앞에서는 무조건 페이지가 나뉜다.
//   2. 소제목만 있는 페이지에는 다음 단락의 BS 결과가 같은 페이지 잔여 공간에
//      채워진다(소제목 단독 페이지를 만들지 않는다).
//   3. 일반 단락이 임계값을 초과하면, 가능하다면 직전 \n\n 경계에서 자르고,
//      페이지 첫 단락이 임계값을 초과하면 단어 단위 BS로 자른다.
//   4. `-` 리스트 항목이 분할되면, 두 번째 이후 청크는 U+3000 한 칸 들여써서
//      목록 들여쓰기 정렬을 유지한다.
//   5. 임계값(threshold)은 화면측이 결정 — 안전 영역 내부 92% 한계.
//   6. BS 측정과 페이지 측정 모두 동일한 폭/폰트/라인하이트로 진행돼야 한다.
// ─────────────────────────────────────────────────────────────────────────────

export type BSResult = { wordOffset: number; wordCount: number };

export type BSJob = {
  paraIdx: number;
  allWords: string[];
  wordOffset: number;
  targetH: number;
};

/** ### 등 소제목 라인이 단락 중간에 나타나면 해당 라인 앞에서 단락을 분리한다. */
export function splitAtSectionBoundaries(para: string): string[] {
  const lines = para.split("\n");
  const result: string[] = [];
  let current: string[] = [];
  for (const line of lines) {
    if (SECTION_BOUNDARY_RE.test(line) && current.some((l) => l.trim())) {
      result.push(current.join("\n").trim());
      current = [line];
    } else {
      current.push(line);
    }
  }
  if (current.some((l) => l.trim())) {
    result.push(current.join("\n").trim());
  }
  return result.filter((c) => c.trim());
}

/** content(페이지 구분자 포함) → 분할 엔진 입력용 단락 배열. */
export function splitContentForDivision(content: string): string[] {
  const plain = content.replace(new RegExp(`\n?${PAGE_DIVIDER}\n?`, "gm"), "\n\n");
  return splitPageContentForDivision(plain);
}

/** 단일 페이지 내용을 엔진 입력용 단락 배열로 분해한다. */
export function splitPageContentForDivision(pageContent: string): string[] {
  const rawParas = pageContent.split("\n\n").filter((p) => p.trim());
  return rawParas.flatMap(splitAtSectionBoundaries);
}

function isHeadingPara(para: string): boolean {
  return SECTION_BOUNDARY_RE.test(para.split("\n")[0] ?? "");
}

/**
 * 자동분할 BS와 동일한 단어 토큰화. 공백(스페이스)만으로 분리하며 빈 토큰은 제거한다.
 * 줄바꿈/탭은 단어에 포함된 채 유지된다.
 *
 * 분할 화면의 빨간 배경 시작 위치 계산도 같은 토큰화·측정 입력을 사용해
 * 자동분할이 만들 페이지 경계와 강조 시작 위치가 정합하도록 한다.
 */
export function paraToWords(para: string): string[] {
  return para.split(/ +/).filter((w) => w);
}

/**
 * 그리디 시뮬레이션 — paraHeights를 보고 BS가 필요한 (paraIdx, wordOffset, targetH)
 * 잡 목록을 만든다. 실제 페이지 컴팩션(runGreedy)을 수행하기 전에 호출되며,
 * 측정만으로 어떤 단락이 BS 분할이 필요한지를 결정한다.
 */
export function simulateGreedyJobs(
  paragraphs: string[],
  paraHeights: Record<number, number>,
  threshold: number,
): BSJob[] {
  const bsJobs: BSJob[] = [];
  let simParaIdxs: number[] = [];
  let simH = 0;

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const paraH = paraHeights[i] ?? 0;
    const isHeading = isHeadingPara(para);

    // 규칙 1: 소제목 → 무조건 페이지 분할
    if (isHeading && simParaIdxs.length > 0) {
      simParaIdxs = [];
      simH = 0;
    }

    if (simH + paraH <= threshold) {
      simParaIdxs.push(i);
      simH += paraH;
    } else if (simParaIdxs.length > 0) {
      const isHeadingOnlyPage = simParaIdxs.every((pi) => isHeadingPara(paragraphs[pi]));
      if (isHeadingOnlyPage) {
        // 규칙 2: 소제목 단독 페이지 잔여 공간 채우기
        const remainingH = Math.max(0, threshold - simH);
        const allWords = paraToWords(para);
        if (allWords.length > 1 && remainingH > 0) {
          bsJobs.push({ paraIdx: i, allWords, wordOffset: 0, targetH: remainingH });
        }
        simParaIdxs = [i];
        simH = paraH * 0.5;
      } else {
        // 규칙 3 Case A: 직전 \n\n 경계에서 자르고 현재 단락은 다음 페이지 시작
        simParaIdxs = [i];
        simH = paraH;
        // 단락 자체가 임계값 초과면 BS 추가 (마지막 단락 누락 방지)
        if (paraH > threshold) {
          const allWords = paraToWords(para);
          if (allWords.length > 1) {
            bsJobs.push({ paraIdx: i, allWords, wordOffset: 0, targetH: threshold });
            simH = paraH * 0.5;
          }
        }
      }
    } else {
      // 규칙 3 Case B: 페이지 첫 단락 초과 → 전체 임계값 기준 BS
      const allWords = paraToWords(para);
      if (allWords.length > 1) {
        bsJobs.push({ paraIdx: i, allWords, wordOffset: 0, targetH: threshold });
      }
      simParaIdxs = [i];
      simH = paraH * 0.5;
    }
  }

  return bsJobs;
}

/**
 * 측정된 후보 높이 맵으로 단일 BS 잡을 풀어 cut word count를 결정한다.
 * heights 키: bsCandidateKey(paraIdx, wordOffset, count).
 * 후보 목록(bsCandidatesForJob)에 포함된 count들에 대해 모노토닉 가정 하에
 * targetH 이하인 최대 count를 반환한다. (전형적으로 1..N 전체를 측정한다.)
 */
export function resolveBSJob(
  job: BSJob,
  heights: Record<string, number>,
): { wordCount: number; nextOffset: number; hasRemaining: boolean } {
  const N = job.allWords.length - job.wordOffset;
  let best = 1;
  let lo = 1;
  let hi = N;
  while (lo <= hi) {
    const mid = Math.floor((lo + hi) / 2);
    const h = heights[bsCandidateKey(job.paraIdx, job.wordOffset, mid)];
    if (h === undefined) {
      // 측정 누락 시 보수적으로 hi를 줄여 무한 루프 방지
      hi = mid - 1;
      continue;
    }
    if (h <= job.targetH) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const nextOffset = job.wordOffset + best;
  return {
    wordCount: best,
    nextOffset,
    hasRemaining: nextOffset < job.allWords.length,
  };
}

export function bsCandidateKey(paraIdx: number, wordOffset: number, count: number): string {
  return `bs_${paraIdx}_${wordOffset}_${count}`;
}

/** BS 측정용 후보 텍스트 — 측정 시에는 들여쓰기 prefix를 붙이지 않는다. */
export function bsCandidateText(allWords: string[], wordOffset: number, count: number): string {
  return allWords.slice(wordOffset, wordOffset + count).join(" ");
}

/**
 * BS 잡 하나에 대해 측정해야 할 후보들의 [count, content] 배열을 반환한다.
 * 기본 전략: 1..N 모든 길이를 한 번에 측정 → JS 측에서 BS 수렴.
 * (한 번의 mount로 모든 candidate를 동시에 측정해 BS 스텝당 풀 리렌더를 없앤다.)
 */
export function bsCandidatesForJob(job: BSJob): { count: number; content: string }[] {
  const N = job.allWords.length - job.wordOffset;
  const out: { count: number; content: string }[] = [];
  for (let c = 1; c <= N; c++) {
    out.push({ count: c, content: bsCandidateText(job.allWords, job.wordOffset, c) });
  }
  return out;
}

/**
 * 그리디 페이지 컴팩션 (순수 함수).
 * splitResults: 각 단락의 다단(多段) 분할 정보. 한 단락이 3~4 페이지에 걸쳐도
 * 결과 entry를 순서대로 적용해 모두 별도 페이지로 분리한다.
 */
export function runGreedy(
  paragraphs: string[],
  paraHeights: Record<number, number>,
  splitResults: Record<number, BSResult[]>,
  threshold: number,
): string[] {
  const pages: string[] = [];
  let currentParas: string[] = [];
  let currentH = 0;

  const applyBSSplit = (para: string, paraH: number, paraIdx: number) => {
    const results = splitResults[paraIdx];
    const allWords = paraToWords(para);
    const isListItem = /^-\s/.test(para);

    if (!results || results.length === 0) {
      pages.push([...currentParas, para].join("\n\n"));
      currentParas = [];
      currentH = 0;
      return;
    }

    let offset = 0;
    for (let ri = 0; ri < results.length; ri++) {
      const { wordOffset, wordCount } = results[ri];
      const rawChunk = allWords.slice(wordOffset, wordOffset + wordCount).join(" ");
      const chunk = ri > 0 && isListItem && rawChunk ? "\u3000" + rawChunk : rawChunk;
      offset = wordOffset + wordCount;

      if (ri === 0) {
        if (rawChunk) currentParas.push(rawChunk);
        pages.push(currentParas.join("\n\n"));
        currentParas = [];
        currentH = 0;
      } else {
        if (chunk) pages.push(chunk);
      }
    }

    if (offset < allWords.length) {
      const rawRemaining = allWords.slice(offset).join(" ");
      const remaining = isListItem ? "\u3000" + rawRemaining : rawRemaining;
      currentParas = [remaining];
      currentH = (paraH * (allWords.length - offset)) / allWords.length;
    }
  };

  for (let i = 0; i < paragraphs.length; i++) {
    const para = paragraphs[i];
    const paraH = paraHeights[i] ?? 0;
    const isHeading = isHeadingPara(para);

    if (isHeading && currentParas.length > 0) {
      pages.push(currentParas.join("\n\n"));
      currentParas = [];
      currentH = 0;
    }

    if (currentH + paraH <= threshold) {
      currentParas.push(para);
      currentH += paraH;
    } else if (currentParas.length > 0) {
      const isHeadingOnlyPage = currentParas.every((p) => isHeadingPara(p));
      if (isHeadingOnlyPage) {
        applyBSSplit(para, paraH, i);
      } else {
        pages.push(currentParas.join("\n\n"));
        currentParas = [];
        currentH = 0;
        if (paraH > threshold && splitResults[i]?.length) {
          applyBSSplit(para, paraH, i);
        } else {
          currentParas = [para];
          currentH = paraH;
        }
      }
    } else {
      applyBSSplit(para, paraH, i);
    }
  }

  if (currentParas.length > 0) pages.push(currentParas.join("\n\n"));
  return pages.filter((p) => p.trim());
}
