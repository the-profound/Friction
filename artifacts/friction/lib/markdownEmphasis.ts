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