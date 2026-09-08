/**
 * Turndown may escape emphasis delimiters when they occur at a paragraph
 * boundary (for example, `\*\*bold\*\*`). The next Markdown parser then sees
 * literal backslashes instead of a strong node. Remove only escapes that are
 * flanking an emphasis run; isolated literal asterisks remain escaped.
 */
export function normalizeMarkdownEmphasisDelimiters(markdown: string): string {
  return markdown
    .replace(/\\(\*{1,3})(?=\S)/g, "$1")
    .replace(/(\S)\\(\*{1,3})/g, "$1$2")
    .replace(/\\(_+)/g, "$1");
}

type EmphasisDelimiter = "*" | "**" | "***" | "_";

interface MatchedEmphasisSpan {
  delimiter: EmphasisDelimiter;
  start: number;
  end: number;
  depth: number;
}

function resolveTripleOpeningRuns(
  text: string,
  afterIndex: number,
): EmphasisDelimiter[] {
  const laterRuns = /(?<!\\)\*{1,3}/g;
  laterRuns.lastIndex = afterIndex;
  let later: RegExpExecArray | null;
  while ((later = laterRuns.exec(text)) !== null) {
    const previous = text[later.index - 1];
    const next = text[later.index + later[0].length];
    const previousIsWhitespace = previous == null || /\s/u.test(previous);
    const nextIsWhitespace = next == null || /\s/u.test(next);
    const previousIsPunctuation =
      previous != null && /[\p{P}\p{S}]/u.test(previous);
    const nextIsPunctuation = next != null && /[\p{P}\p{S}]/u.test(next);
    const rightFlanking =
      !previousIsWhitespace
      && (!previousIsPunctuation || nextIsWhitespace || nextIsPunctuation);
    if (!rightFlanking) continue;
    if (later[0].length === 2) return ["*", "**"];
    if (later[0].length === 1) return ["**", "*"];
    return ["**", "*"];
  }
  return ["**", "*"];
}

function findMatchedEmphasisSpans(text: string): MatchedEmphasisSpan[] {
  const stack: Array<{
    delimiter: EmphasisDelimiter;
    start: number;
    depth: number;
  }> = [];
  const spans: MatchedEmphasisSpan[] = [];
  const delimiters = /(?<!\\)(\*{1,3}|_)/g;
  let match: RegExpExecArray | null;
  while ((match = delimiters.exec(text)) !== null) {
    const delimiter = match[1] as EmphasisDelimiter;
    const previous = text[match.index - 1];
    const next = text[match.index + delimiter.length];
    const previousIsWhitespace = previous == null || /\s/u.test(previous);
    const nextIsWhitespace = next == null || /\s/u.test(next);
    const previousIsPunctuation = previous != null && /[\p{P}\p{S}]/u.test(previous);
    const nextIsPunctuation = next != null && /[\p{P}\p{S}]/u.test(next);
    const leftFlanking =
      !nextIsWhitespace
      && (!nextIsPunctuation || previousIsWhitespace || previousIsPunctuation);
    const rightFlanking =
      !previousIsWhitespace
      && (!previousIsPunctuation || nextIsWhitespace || nextIsPunctuation);
    const canOpen = delimiter === "_"
      ? leftFlanking && (!rightFlanking || previousIsPunctuation)
      : leftFlanking;
    const canClose = delimiter === "_"
      ? rightFlanking && (!leftFlanking || nextIsPunctuation)
      : rightFlanking;

    if (delimiter === "_") {
      const top = stack[stack.length - 1];
      if (top?.delimiter === "_" && canClose) {
        stack.pop();
        spans.push({
          delimiter,
          start: top.start,
          end: match.index,
          depth: top.depth,
        });
      } else if (canOpen) {
        stack.push({ delimiter, start: match.index, depth: stack.length });
      }
      continue;
    }

    let remaining = delimiter.length;
    if (canClose) {
      while (remaining > 0) {
        const top = stack[stack.length - 1];
        if (!top || top.delimiter === "_") break;
        if (top.delimiter.length > remaining) break;
        stack.pop();
        spans.push({
          delimiter: top.delimiter,
          start: top.start,
          end: match.index,
          depth: top.depth,
        });
        remaining -= top.delimiter.length;
      }
    }
    if (canOpen && remaining > 0) {
      const openingRuns: EmphasisDelimiter[] =
        remaining === 3
          ? resolveTripleOpeningRuns(text, match.index + delimiter.length)
          : [remaining === 2 ? "**" : "*"];
      for (const opening of openingRuns) {
        stack.push({ delimiter: opening, start: match.index, depth: stack.length });
      }
    }
  }
  return spans;
}

/**
 * A page is rendered as an independent Markdown document. If automatic
 * division cuts through one editor emphasis mark, close it at the end of the
 * page and reopen it on the next page without changing visible text.
 */
export function balanceMarkdownEmphasisAcrossChunks(chunks: string[]): string[] {
  if (chunks.length < 2) return chunks;
  const whole = chunks.join(" ");
  const spans = findMatchedEmphasisSpans(whole);
  let offset = 0;
  return chunks.map((chunk, index) => {
    const startBoundary = offset - 1;
    const endBoundary = offset + chunk.length;
    const atStart = index === 0
      ? []
      : spans
        .filter((span) => span.start < startBoundary && span.end > startBoundary)
        .sort((a, b) => a.depth - b.depth);
    const atEnd = index === chunks.length - 1
      ? []
      : spans
        .filter((span) => span.start < endBoundary && span.end > endBoundary)
        .sort((a, b) => b.depth - a.depth);
    const prefix = atStart.map((span) => span.delimiter).join("");
    const suffix = atEnd.map((span) => span.delimiter).join("");
    offset = endBoundary + 1;
    return `${prefix}${chunk}${suffix}`;
  });
}