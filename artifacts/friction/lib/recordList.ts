import type { Article, Thought } from "@workspace/api-client-react";
import { parseMarkdownBlocks, tokensToPlainText } from "../utils/markdownParser";
import { toKstCalendarDateKey } from "./kstDate";

export type RecordKind = "thought" | "editing" | "letter";
export type RecordView = "card" | "content";

export type UnifiedRecord =
  | { id: string; kind: "thought"; updatedAt: string; thought: Thought }
  | { id: string; kind: "editing" | "letter"; updatedAt: string; article: Article };

export interface RecordDateGroup<T extends UnifiedRecord = UnifiedRecord> {
  dateKey: string;
  label: string;
  records: T[];
}

export interface RecordPreview {
  /** Single-line form used for title-only mode and search. */
  title: string;
  /** Keeps intentional title line breaks for content-preview mode. */
  titleDisplay: string;
  body: string;
  hasTitle: boolean;
}

/**
 * Card view is deliberately separate from RecordPreview. Preview values are
 * compact/searchable by design, while the one-at-a-time reader needs the
 * author-entered visual line structure.
 */
export interface RecordCardContent {
  title: string;
  body: string;
  hasTitle: boolean;
}

export const RECORD_CARD_TITLE_MAX_LINES = 2;

/**
 * Korean glyphs are approximately one title-font em wide. This conservative
 * estimate reserves no more than the two visible title lines when calculating
 * the body's remaining card space, including authored line breaks.
 */
export function getRecordCardTitleLineCount(
  title: string,
  titleSize: number,
  textWidth: number,
): number {
  const charsPerLine = Math.max(1, Math.floor(textWidth / titleSize));
  const estimatedLines = title.split("\n").reduce(
    (total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / charsPerLine)),
    0,
  );
  return Math.min(RECORD_CARD_TITLE_MAX_LINES, Math.max(1, estimatedLines));
}

export function getRecordCardBodyLineCount({
  cardHeight,
  paddingY,
  titleLineCount,
  titleLineHeight,
  titleGap,
  bodyLineHeight,
}: {
  cardHeight: number;
  paddingY: number;
  titleLineCount: number;
  titleLineHeight: number;
  titleGap: number;
  bodyLineHeight: number;
}): number {
  const titleHeight = titleLineCount * titleLineHeight;
  return Math.max(
    1,
    Math.floor((cardHeight - paddingY * 2 - titleHeight - titleGap) / bodyLineHeight),
  );
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
 * Questions in the server-owned queue are shown only through the question
 * flow, never as regular archive thoughts. The aliases keep older cached API
 * responses safe during a client/server rollout.
 */
export function getQueuedThoughtIds(
  queue: Thought[] | null | undefined,
  current: Thought | null | undefined,
  next: Thought | null | undefined,
): Set<string> {
  const queuedThoughts = queue ?? [current, next].filter((thought): thought is Thought => Boolean(thought));
  return new Set(queuedThoughts.map((thought) => thought.id));
}

/** Displays the same compact calendar date label used by the record card groups. */
export function formatRecordDateLabel(dateKey: string): string {
  const [, month, day] = dateKey.split("-");
  return `${Number(month)}월 ${Number(day)}일`;
}

/**
 * Builds the card-only date hierarchy. Records stay deterministically ordered
 * within each KST day and the newest KST day always appears first.
 */
export function buildRecordDateGroups<T extends UnifiedRecord>(records: T[]): RecordDateGroup<T>[] {
  const grouped = new Map<string, T[]>();

  for (const record of [...records].sort(compareRecordsNewestFirst)) {
    const dateKey = toKstCalendarDateKey(record.updatedAt);
    const dateRecords = grouped.get(dateKey);
    if (dateRecords) dateRecords.push(record);
    else grouped.set(dateKey, [record]);
  }

  return Array.from(grouped.entries())
    .sort(([left], [right]) => right.localeCompare(left))
    .map(([dateKey, dateRecords]) => ({
      dateKey,
      label: formatRecordDateLabel(dateKey),
      records: dateRecords,
    }));
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

function normalizeDisplayLineEndings(value: string | null | undefined): string {
  return (value ?? "").replace(/\r\n?/g, "\n");
}
export function recordMatchesQuery(record: UnifiedRecord, rawQuery: string): boolean {
  const query = normalizePreviewText(rawQuery).toLocaleLowerCase();
  if (!query) return true;
  const preview = getRecordPreview(record);
  return `${preview.title} ${preview.body}`.toLocaleLowerCase().includes(query);
}

/**
 * The card is a reading surface, not a search result: article title/body are
 * preserved as entered. List and search callers must keep using
 * getRecordPreview instead.
 */
export function getRecordCardContent(record: UnifiedRecord): RecordCardContent {
  if (record.kind === "thought") return getThoughtCardContent(record.thought.content);
  const title = normalizeDisplayLineEndings(record.article.title);
  return {
    title,
    body: normalizeDisplayLineEndings(record.article.content),
    hasTitle: Boolean(title),
  };
}

/**
 * Plain-text rendering for a thought card. Unlike the list preview this never
 * collapses spaces or joins paragraph boundaries. Markdown markup is removed
 * through the existing parser so a literal author line break still stays a
 * literal line break in the card.
 */
export function getThoughtCardContent(markdown: string | null | undefined): RecordCardContent {
  const blocks = parseMarkdownBlocks(normalizeDisplayLineEndings(markdown));
  const firstBlock = blocks[0];
  const hasTitle = firstBlock?.type === "h1";
  const title = hasTitle ? tokensToPlainText(firstBlock.tokens) : "";
  const bodyBlocks = hasTitle ? blocks.slice(1) : blocks;
  // Block tokens remove Markdown syntax while retaining authored hard line
  // breaks. Empty paragraph blocks encode additional blank lines beyond the
  // normal paragraph separator.
  const body = bodyBlocks.reduce((text, block) => {
    const line = tokensToPlainText(block.tokens);
    if (!line) return text ? `${text}\n\n` : text;
    if (!text) return line;
    return `${text}${text.endsWith("\n") ? "\n" : "\n\n"}${line}`;
  }, "");

  return {
    title,
    body,
    hasTitle: Boolean(title),
  };
}
