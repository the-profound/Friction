import type { StoredSentence } from "@workspace/api-client-react";

export type StoredSentenceQuote = {
  text: string;
  attribution?: string;
};

function getStoredSentencePage(position: unknown): number | undefined {
  if (!position || typeof position !== "object" || !("page" in position)) {
    return undefined;
  }
  const page = (position as { page?: unknown }).page;
  return typeof page === "number" && Number.isFinite(page) ? page : undefined;
}

/**
 * Resolve a collected sentence's source using the same priority everywhere:
 * the user's source label first, then the connected article title and page.
 * A missing source is represented by an omitted attribution, never by an
 * empty string or the literal "undefined".
 */
export function getStoredSentenceQuoteAttribution(
  sentence: Pick<StoredSentence, "sourceText" | "articleTitle" | "position">,
): string | undefined {
  const customSource = sentence.sourceText?.trim();
  if (customSource) return customSource;

  const articleTitle = sentence.articleTitle?.trim();
  if (!articleTitle) return undefined;

  const page = getStoredSentencePage(sentence.position);
  return `<${articleTitle}>${page === undefined ? "" : `, ${page + 1}면`}`;
}

export function buildStoredSentenceQuote(sentence: StoredSentence): StoredSentenceQuote {
  const attribution = getStoredSentenceQuoteAttribution(sentence);
  return attribution ? { text: sentence.text, attribution } : { text: sentence.text };
}