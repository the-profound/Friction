/**
 * The canonical representation of a thought while it is being edited.
 *
 * A thought keeps its first H1 in `markdown`, while a review article keeps
 * the same H1 outside `bodyMarkdown`.  Keeping both forms here prevents a
 * caller from pairing a title from one editor export with a body from
 * another export.
 */
export interface ThoughtDocumentSnapshot {
  markdown: string;
  titleMarkdown: string;
  title: string;
  bodyMarkdown: string;
  docVersion: number;
  editorSessionId: string;
}

export interface ThoughtDocumentMetadata {
  docVersion?: number;
  editorSessionId?: string;
}

export interface ThoughtDocumentParts {
  titleMarkdown: string;
  title: string;
  bodyMarkdown: string;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

/**
 * Splits only a leading ATX level-one heading. A following line is part of
 * the title only when the previous line has Markdown's hard-break marker.
 */
export function splitLeadingThoughtH1(markdown: string): ThoughtDocumentParts | null {
  if (typeof markdown !== "string") return null;

  const lines = normalizeNewlines(markdown).split("\n");
  const first = /^ {0,3}#(?!#)[ \t]+(.*)$/.exec(lines[0] ?? "");
  if (!first) return null;

  const titleLines = [first[1]];
  let cursor = 1;
  while (cursor < lines.length) {
    const previous = titleLines[titleLines.length - 1];
    if (!/[ \t]{2,}$/.test(previous) || lines[cursor].trim() === "") break;
    titleLines[titleLines.length - 1] = previous.replace(/[ \t]{2,}$/, "");
    titleLines.push(lines[cursor]);
    cursor += 1;
  }
  titleLines[titleLines.length - 1] = titleLines[titleLines.length - 1].replace(
    /[ \t]{2,}$/,
    "",
  );

  const titleMarkdown = titleLines.join("  \n");
  return {
    titleMarkdown,
    title: thoughtTitleMarkdownToText(titleMarkdown),
    bodyMarkdown: lines.slice(cursor).join("\n").replace(/^\n/, ""),
  };
}

function decodeNumericEntities(value: string): string {
  return value.replace(/&#(\d+);/g, (match, rawCodePoint: string) => {
    const codePoint = Number(rawCodePoint);
    return Number.isInteger(codePoint) && codePoint >= 0 && codePoint <= 0x10ffff
      ? String.fromCodePoint(codePoint)
      : match;
  });
}

/**
 * Converts the inline Markdown allowed in a title to the text the user sees.
 * Formatting markers are removed, link/image destinations are discarded,
 * escapes remain literal, and hard-break lines remain newlines.
 */
export function thoughtTitleMarkdownToText(titleMarkdown: string): string {
  const escapedCharacters: string[] = [];
  const protectedValue = normalizeNewlines(titleMarkdown).replace(
    /\\([\\!"#$%&'()*+,\-./:;<=>?@\[\]^_`{|}~])/g,
    (_match, character: string) => {
      const token = `\uE000${escapedCharacters.length}\uE001`;
      escapedCharacters.push(character);
      return token;
    },
  );

  const visibleText = protectedValue
    .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
    .replace(/<\/?u>/gi, "")
    .replace(/[*_~`]+/g, "")
    .split("\n")
    .map((line) => line.trim())
    .join("\n");
  const decodedText = decodeNumericEntities(visibleText);
  return decodedText.replace(/\uE000(\d+)\uE001/g, (_match, index: string) =>
    escapedCharacters[Number(index)] ?? "",
  );
}

function escapeThoughtTitleLine(line: string): string {
  const escaped = line.replace(
    /([\\!"#$%&'()*+,\-./:;<=>?@\[\]^_`{|}~])/g,
    "\\$1",
  );
  return escaped.replace(/^\s+|\s+$/g, (whitespace) =>
    [...whitespace]
      .map((character) => `&#${character.codePointAt(0)};`)
      .join(""),
  );
}

/** Serializes review title/body fields back into a complete thought document. */
export function serializeThoughtDocument(title: string, bodyMarkdown: string): string {
  const normalizedTitle = normalizeNewlines(title);
  const normalizedBody = normalizeNewlines(bodyMarkdown);
  const titleMarkdown = normalizedTitle.split("\n").map(escapeThoughtTitleLine).join("  \n");
  return `# ${titleMarkdown}\n\n${normalizedBody}`;
}

/** Creates one immutable snapshot from one editor export response. */
export function createThoughtDocumentSnapshot(
  markdown: string,
  metadata: ThoughtDocumentMetadata = {},
): ThoughtDocumentSnapshot | null {
  const normalizedMarkdown = normalizeNewlines(markdown);
  const parts = splitLeadingThoughtH1(normalizedMarkdown);
  if (!parts) return null;
  return {
    markdown: normalizedMarkdown,
    titleMarkdown: parts.titleMarkdown,
    title: parts.title,
    bodyMarkdown: parts.bodyMarkdown,
    docVersion: metadata.docVersion ?? 0,
    editorSessionId: metadata.editorSessionId ?? "",
  };
}

/**
 * Builds the same snapshot shape for review articles, whose title is already
 * outside the Markdown body. This is intentionally separate from thought
 * decoding so a missing H1 can never be silently invented during promotion.
 */
export function createReviewDocumentSnapshot(
  bodyMarkdown: string,
  title: string,
  metadata: ThoughtDocumentMetadata = {},
): ThoughtDocumentSnapshot {
  const normalizedBody = normalizeNewlines(bodyMarkdown);
  const normalizedTitle = normalizeNewlines(title);
  const titleMarkdown = normalizedTitle.split("\n").map(escapeThoughtTitleLine).join("  \n");
  return {
    markdown: normalizedBody,
    titleMarkdown,
    title: normalizedTitle,
    bodyMarkdown: normalizedBody,
    docVersion: metadata.docVersion ?? 0,
    editorSessionId: metadata.editorSessionId ?? "",
  };
}
