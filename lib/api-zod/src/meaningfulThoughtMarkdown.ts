/**
 * Determines whether Markdown contains content worth persisting as a thought.
 * Markdown structure alone (#, emphasis, lists, horizontal rules, etc.) is not
 * content. The same rule is represented by the database constraint: at least
 * one character must remain after removing Markdown punctuation and whitespace.
 */
export function isMeaningfulThoughtMarkdown(markdown: string): boolean {
  const normalized = markdown.replace(/\r\n?/g, "\n");
  const hasValidImage = /!\[[^\]]*\]\(\s*[^)\s][^)]*\)/.test(normalized);

  // Remove image syntax before the generic visible-character check so a broken
  // image URL cannot count as prose. A syntactically complete image is still
  // meaningful even with blank alt text.
  const withoutFormatting = normalized
    .replace(/!\[[^\]]*\]\([^)]*\)?/g, "")
    .replace(/[`#*_~>|[\](){},.!+\-=]/g, "")
    .replace(/\s/g, "");

  return hasValidImage || withoutFormatting.length > 0;
}