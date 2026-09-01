export interface LeadingH1Markdown {
  titleMarkdown: string;
  body: string;
}

/**
 * Splits the leading ATX H1 from its body while preserving authored hard
 * breaks inside that H1. A continuation belongs to the title only when the
 * preceding title line ends with Markdown's two-space hard-break marker.
 */
export function splitLeadingH1Markdown(markdown: string): LeadingH1Markdown | null {
  if (typeof markdown !== "string") return null;

  const normalized = markdown.replace(/\r\n?/g, "\n");
  const lines = normalized.split("\n");
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

  titleLines[titleLines.length - 1] = titleLines[titleLines.length - 1].replace(/[ \t]{2,}$/, "");
  const body = lines.slice(cursor).join("\n").replace(/^\n/, "");
  return {
    titleMarkdown: titleLines.join("  \n"),
    body,
  };
}