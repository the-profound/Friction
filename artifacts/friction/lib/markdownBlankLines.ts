export const PRESERVED_BLANK_PARAGRAPH_ATTRIBUTE = "data-friction-preserved-blank";
export const CARET_PARAGRAPH_ATTRIBUTE = "data-friction-caret-paragraph";

const PRESERVED_BLANK_PARAGRAPH =
  `<p ${PRESERVED_BLANK_PARAGRAPH_ATTRIBUTE}="true"></p>`;

export const CARET_PARAGRAPH_HTML =
  `<p ${CARET_PARAGRAPH_ATTRIBUTE}="true"></p>`;

/**
 * CommonMark collapses every run of two-or-more newlines into one block
 * boundary. The editor document needs one empty paragraph for every newline
 * beyond that boundary so authored vertical whitespace survives a round trip.
 */
export function preserveMarkdownBlankLinesForEditor(markdown: string): string {
  const normalized = String(markdown ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^\n+/, "");
  const trailingNewlineCount = normalized.match(/\n+$/)?.[0].length ?? 0;
  const body = trailingNewlineCount > 0
    ? normalized.slice(0, -trailingNewlineCount)
    : normalized;
  const preservedBody = body.replace(/\n{3,}/g, (run) => {
      const emptyParagraphCount = run.length - 2;
      return `\n\n${Array.from(
        { length: emptyParagraphCount },
        () => PRESERVED_BLANK_PARAGRAPH,
      ).join("\n\n")}\n\n`;
    });

  if (!preservedBody || trailingNewlineCount < 3) {
    return preservedBody;
  }

  return `${preservedBody}\n\n${Array.from(
    { length: trailingNewlineCount - 2 },
    () => PRESERVED_BLANK_PARAGRAPH,
  ).join("\n\n")}`;
}

export function isPreservedBlankParagraphLine(line: string): boolean {
  return line.trim() === PRESERVED_BLANK_PARAGRAPH;
}

/**
 * Turndown intentionally discards empty paragraphs. Callers temporarily put
 * this marker inside them, then restore the marker runs after conversion.
 */
const EMPTY_PARAGRAPH_MARKER_BASE = "FRICTIONEMPTYBLANKPARAGRAPH";

export function createEmptyParagraphMarker(existingText: string): string {
  let marker = EMPTY_PARAGRAPH_MARKER_BASE;
  while (existingText.includes(marker)) marker += "X";
  return marker;
}

export function restoreEmptyParagraphMarkers(markdown: string, marker: string): string {
  const escaped = marker.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const restoreRun = (match: string) => {
    const count = match.match(new RegExp(escaped, "g"))?.length ?? 0;
    return "\n".repeat(count + 2);
  };

  // Turndown and the native serializer both trim their final block separator.
  // Restore a terminal authored-empty run before handling body-internal runs.
  const withTerminalRunRestored = markdown.replace(
    new RegExp(`\\n\\n${escaped}(?:\\n\\n${escaped})*$`),
    restoreRun,
  );

  return withTerminalRunRestored.replace(
    new RegExp(`\\n\\n((?:${escaped}\\n\\n)+)`, "g"),
    restoreRun,
  );
}