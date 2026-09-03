import { MarkdownPolicy } from "./policies";

const PAGE_DIVIDER = MarkdownPolicy.PAGE_DIVIDER;
const PAGE_DIVIDER_LINE_RE = new RegExp(`^[\\t ]*${PAGE_DIVIDER}[\\t ]*$`);

/**
 * The app uses a thematic-break line as a page boundary. Markdown parsers
 * disagree when that line directly follows paragraph text: CommonMark treats
 * `text\n---` as a Setext heading, while the editor treats it as a divider.
 *
 * Add blank lines around only standalone divider lines before parsing. This
 * keeps authored ATX headings and inline formatting untouched while making the
 * app's page-boundary meaning explicit to every parser.
 */
export function normalizePageDividersForMarkdownParser(markdown: string): string {
  const lines = String(markdown ?? "").replace(/\r\n?/g, "\n").split("\n");
  const normalized: string[] = [];

  lines.forEach((line, index) => {
    if (!PAGE_DIVIDER_LINE_RE.test(line)) {
      normalized.push(line);
      return;
    }

    if (normalized.length > 0 && normalized[normalized.length - 1].trim() !== "") {
      normalized.push("");
    }
    normalized.push(PAGE_DIVIDER);

    const nextLine = lines[index + 1];
    if (nextLine !== undefined && nextLine.trim() !== "") {
      normalized.push("");
    }
  });

  return normalized.join("\n");
}

export function isPageDividerLine(line: string): boolean {
  return PAGE_DIVIDER_LINE_RE.test(line);
}