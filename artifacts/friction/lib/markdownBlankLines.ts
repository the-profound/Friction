const PRESERVED_BLANK_PARAGRAPH = '<p data-friction-preserved-blank="true"></p>';

/**
 * CommonMark collapses every run of two-or-more newlines into one block
 * boundary. The editor document needs one empty paragraph for every newline
 * beyond that boundary so authored vertical whitespace survives a round trip.
 */
export function preserveMarkdownBlankLinesForEditor(markdown: string): string {
  return String(markdown ?? "")
    .replace(/\r\n?/g, "\n")
    // Editor document boundaries are canonicalized; only body-internal blank
    // lines are authored structure.
    .replace(/^\n+|\n+$/g, "")
    .replace(/\n{3,}/g, (run) => {
      const emptyParagraphCount = run.length - 2;
      return `\n\n${Array.from(
        { length: emptyParagraphCount },
        () => PRESERVED_BLANK_PARAGRAPH,
      ).join("\n\n")}\n\n`;
    });
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
  return markdown.replace(
    new RegExp(`\\n\\n((?:${escaped}\\n\\n)+)`, "g"),
    (_match, markerRun: string) => {
      const count = markerRun.match(new RegExp(escaped, "g"))?.length ?? 0;
      return "\n".repeat(count + 2);
    },
  );
}