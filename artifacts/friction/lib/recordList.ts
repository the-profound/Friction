import type { Article, Thought } from "@workspace/api-client-react";
import { parseMarkdownBlocks, tokensToPlainText } from "../utils/markdownParser";

export type RecordKind = "thought" | "editing" | "letter";
export type RecordView = "card" | "content" | "title";

export type UnifiedRecord =
  | { id: string; kind: "thought"; updatedAt: string; thought: Thought }
  | { id: string; kind: "editing" | "letter"; updatedAt: string; article: Article };

export interface RecordPreview {
  /** Single-line form used for title-only mode and search. */
  title: string;
  /** Keeps intentional title line breaks for content-preview mode. */
  titleDisplay: string;
  body: string;
  hasTitle: boolean;
}

/**
 * Keep record rows deterministic: a server can legitimately assign the same
 * timestamp to several writes, so the stable identifier is the final tie-break.
 */
export function compareRecordsNewestFirst(a: UnifiedRecord, b: UnifiedRecord): number {
  const timeDiff = new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
  return timeDiff || a.id.localeCompare(b.id);
}

export function buildUnifiedRecords(
  thoughts: Thought[] | undefined,
  articles: Article[] | undefined,
): UnifiedRecord[] {
  const thoughtRecords: UnifiedRecord[] = (thoughts ?? []).map((thought) => ({
    id: thought.id,
    kind: "thought",
    updatedAt: thought.updatedAt,
    thought,
  }));
  const articleRecords: UnifiedRecord[] = (articles ?? [])
    .map((article) => ({
      id: article.id,
      kind: article.status === "LETTER" ? "letter" : "editing",
      updatedAt: article.updatedAt,
      article,
    }));

  return [...thoughtRecords, ...articleRecords].sort(compareRecordsNewestFirst);
}

export function filterRecords(records: UnifiedRecord[], kind: RecordKind): UnifiedRecord[] {
  return records.filter((record) => record.kind === kind);
}

/**
 * Normalizes text intended for one-line/list previews.
 * Whitespace directly beside a line break is discarded first; every remaining
 * run of whitespace then becomes exactly one visible space.
 */
export function normalizePreviewText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*\n[ \t]*/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function normalizePreviewTitle(value: string | null | undefined): string {
  if (!value) return "";
  return value
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+/g, " ").trim())
    .filter(Boolean)
    .join("\n");
}

export function getThoughtPreview(markdown: string | null | undefined): RecordPreview {
  const blocks = parseMarkdownBlocks(markdown ?? "");
  const firstBlock = blocks[0];
  const hasTitle = firstBlock?.type === "h1";
  const title = hasTitle ? normalizePreviewText(tokensToPlainText(firstBlock.tokens)) : "";
  const bodyBlocks = hasTitle ? blocks.slice(1) : blocks;
  const body = normalizePreviewText(
    bodyBlocks.map((block) => tokensToPlainText(block.tokens)).join("\n"),
  );

  return { title, titleDisplay: title, body, hasTitle: Boolean(title) };
}

export function getRecordPreview(record: UnifiedRecord): RecordPreview {
  if (record.kind === "thought") return getThoughtPreview(record.thought.content);
  const title = normalizePreviewText(record.article.title);
  const titleDisplay = normalizePreviewTitle(record.article.title);
  const body = normalizePreviewText(record.article.content);
  return { title, titleDisplay, body, hasTitle: Boolean(title) };
}

export function recordMatchesQuery(record: UnifiedRecord, rawQuery: string): boolean {
  const query = normalizePreviewText(rawQuery).toLocaleLowerCase();
  if (!query) return true;
  const preview = getRecordPreview(record);
  return `${preview.title} ${preview.body}`.toLocaleLowerCase().includes(query);
}