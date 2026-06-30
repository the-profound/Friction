/**
 * Memo page serialization helpers shared between read.tsx and tests.
 *
 * A memo's content is stored as a JSON-encoded string[] where each element
 * is one page's markdown.  Legacy entries (written before the JSON format
 * was introduced) are plain strings; parseMemoPages handles them gracefully
 * by returning the raw string as a single-element array.
 */

/**
 * Parse a memo content string into individual page strings.
 *
 * - Valid JSON string[] → array of pages (never empty; falls back to [""])
 * - Empty / falsy       → [""]
 * - Legacy plain string → [content]  (no migration needed)
 */
export function parseMemoPages(content: string): string[] {
  if (!content) return [""];
  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed) && parsed.every((p) => typeof p === "string")) {
      return parsed.length > 0 ? parsed : [""];
    }
  } catch {
    /* not JSON – fall through */
  }
  return [content];
}

/**
 * Serialize an array of page strings back to the JSON format used for
 * storage.  Every string element is preserved exactly as-is (including
 * empty strings) so page structure is round-trippable.
 */
export function serializeMemoPages(pages: string[]): string {
  return JSON.stringify(pages);
}
