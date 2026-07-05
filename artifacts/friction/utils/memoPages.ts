/**
 * Memo page serialization helpers shared between read.tsx and tests.
 *
 * A memo's content is stored as a JSON-encoded string[] where each element
 * is one page's markdown.  Legacy entries (written before the JSON format
 * was introduced) are plain strings; parseMemoPages handles them gracefully
 * by returning the raw string as a single-element array.
 */

/**
 * Parse a memo content string into individual page strings.
 *
 * - Valid JSON string[] → array of pages (never empty; falls back to [""])
 * - Empty / falsy       → [""]
 * - Legacy plain string → [content]  (no migration needed)
 */
export function parseMemoPages(content: string): string[] {
  if (!content) return [""];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) {
      return parsed.length > 0 ? parsed : [""];
    }
  } catch {
    /* not JSON – fall through */
  }
  return [content];
}

/**
 * Serialize an array of page strings back to the JSON format used for
 * storage.  Every string element is preserved exactly as-is (including
 * empty strings) so page structure is round-trippable.
 */
export function serializeMemoPages(pages: string[]): string {
  return JSON.stringify(pages);
}

/** 답한(한 글자 이상 입력한) 질문 카드 하나 — question 원문 + 사용자 답변. */
export interface AnsweredQuestionCard {
  question: string;
  answer: string;
}

/**
 * 여러 메모 페이지를 하나의 평문 텍스트로 합친다. 빈 페이지는 건너뛰고,
 * 페이지 사이는 빈 줄 하나로 구분한다.
 */
export function flattenMemoPages(pages: string[]): string {
  return pages
    .map((p) => p.trim())
    .filter((p) => p.length > 0)
    .join("\n\n");
}

/**
 * 읽기 중 메모 내용(JSON 페이지 배열 또는 레거시 평문)과, 한 글자 이상 답한
 * 질문 카드들을 합쳐 답장 글 본문을 조립한다.
 *
 * 순서: 메모 내용이 위, 질문 카드 답변들이 그 아래. 각 카드는
 * `질문 텍스트` + 빈 줄 + `사용자 답변` 형태이며, 카드 간에도 빈 줄로
 * 구분한다. 메모 섹션과 질문 카드 섹션 사이도 동일하게 빈 줄로 구분한다.
 * 메모만 있거나 카드 답변만 있어도 정상 조립된다.
 */
export function buildReplyContent(
  memoContent: string,
  answeredCards: AnsweredQuestionCard[],
): string {
  const memoSection = flattenMemoPages(parseMemoPages(memoContent));
  const cardsSection = answeredCards
    .filter((card) => card.answer.trim().length > 0)
    .map((card) => `${card.question}\n\n${card.answer.trim()}`)
    .join("\n\n");

  return [memoSection, cardsSection].filter((section) => section.length > 0).join("\n\n");
}
