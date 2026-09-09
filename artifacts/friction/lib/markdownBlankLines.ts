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
  const normalized = String(markdown ?? "").replace(/\r\n?/g, "\n");
  if (!normalized.trim()) return "";
  const leadingNewlineCount = normalized.match(/^\n+/)?.[0].length ?? 0;
  const trailingNewlineCount = normalized.match(/\n+$/)?.[0].length ?? 0;
  const bodyStart = leadingNewlineCount;
  const bodyEnd = trailingNewlineCount > 0
    ? normalized.length - trailingNewlineCount
    : normalized.length;
  const body = normalized.slice(bodyStart, Math.max(bodyStart, bodyEnd));
  const preservedBody = body.replace(/\n{3,}/g, (run) => {
      const emptyParagraphCount = run.length - 2;
      return `\n\n${Array.from(
        { length: emptyParagraphCount },
        () => PRESERVED_BLANK_PARAGRAPH,
      ).join("\n\n")}\n\n`;
    });

  const leading = leadingNewlineCount >= 3
    ? `${Array.from(
      { length: leadingNewlineCount - 2 },
      () => PRESERVED_BLANK_PARAGRAPH,
    ).join("\n\n")}\n\n`
    : "";
  const trailing = trailingNewlineCount >= 3
    ? `\n\n${Array.from(
      { length: trailingNewlineCount - 2 },
      () => PRESERVED_BLANK_PARAGRAPH,
    ).join("\n\n")}`
    : "";

  return `${leading}${preservedBody}${trailing}`;
}

export function isPreservedBlankParagraphLine(line: string): boolean {
  return line.trim() === PRESERVED_BLANK_PARAGRAPH;
}

/**
 * Turndown intentionally discards empty paragraphs. Callers temporarily put
 * this marker inside them, then restore the marker runs after conversion.
 */
const EMPTY_PARAGRAPH_MARKER_BASE = "FRICTIONEMPTYBLANKPARAGRAPH";
const LEAKED_EMPTY_PARAGRAPH_MARKER_PATTERN =
  `${EMPTY_PARAGRAPH_MARKER_BASE}X*`;

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

  // A serializer may remove the final block separator, leaving a document
  // made only of empty paragraphs as a bare marker run. Handle that complete
  // document before the boundary rules that depend on an adjacent separator.
  const markerOnlyDocument = new RegExp(
    `^(?:${escaped}(?:\\n\\n|$))+$`,
  );
  if (markerOnlyDocument.test(markdown)) {
    return restoreRun(markdown);
  }

  // Restore boundary runs first because serializers trim the block separator
  // on one side of the document. Then restore body-internal runs.
  const withLeadingRunRestored = markdown.replace(
    new RegExp(`^(?:${escaped}\\n\\n)*${escaped}\\n\\n`),
    restoreRun,
  );
  const withTerminalRunRestored = withLeadingRunRestored.replace(
    new RegExp(`\\n\\n${escaped}(?:\\n\\n${escaped})*$`),
    restoreRun,
  );

  return withTerminalRunRestored.replace(
    new RegExp(`\\n\\n((?:${escaped}\\n\\n)+)`, "g"),
    restoreRun,
  );
}

export function restoreSerializedEmptyParagraphMarkers(
  markdown: string,
  marker: string,
  options: { removeTrailingBlockSeparator?: boolean } = {},
): string {
  const serialized = options.removeTrailingBlockSeparator
    ? markdown.replace(/\n\n$/, "")
    : markdown;
  return restoreEmptyParagraphMarkers(serialized, marker);
}

/**
 * Repairs documents saved by the former serializer bug. Only standalone
 * marker-family lines are treated as internal data; the same text embedded in
 * an authored sentence remains untouched.
 */
export function restoreLeakedEmptyParagraphMarkers(markdown: string): string {
  const countMarkers = (match: string) =>
    match.match(new RegExp(LEAKED_EMPTY_PARAGRAPH_MARKER_PATTERN, "g"))?.length ?? 0;
  const restoreRun = (match: string) => "\n".repeat(countMarkers(match) + 2);
  const markerOnlyDocument = new RegExp(
    `^(?:${LEAKED_EMPTY_PARAGRAPH_MARKER_PATTERN}(?:\\n\\n|$))+$`,
  );
  if (markerOnlyDocument.test(markdown)) {
    return restoreRun(markdown);
  }
  const leading = markdown.replace(
    new RegExp(`^(?:${LEAKED_EMPTY_PARAGRAPH_MARKER_PATTERN}\\n\\n)+`),
    restoreRun,
  );
  const terminal = leading.replace(
    new RegExp(
      `\\n\\n${LEAKED_EMPTY_PARAGRAPH_MARKER_PATTERN}`
      + `(?:\\n\\n${LEAKED_EMPTY_PARAGRAPH_MARKER_PATTERN})*$`,
    ),
    restoreRun,
  );
  return terminal.replace(
    new RegExp(
      `\\n\\n((?:${LEAKED_EMPTY_PARAGRAPH_MARKER_PATTERN}\\n\\n)+)`,
      "g",
    ),
    restoreRun,
  );
}