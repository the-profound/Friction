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
  maxLines = RECORD_CARD_TITLE_MAX_LINES,
): number {
  const charsPerLine = Math.max(1, Math.floor(textWidth / titleSize));
  const estimatedLines = title.split("\n").reduce(
    (total, line) => total + Math.max(1, Math.ceil(Array.from(line).length / charsPerLine)),
    0,
  );
  return Math.min(maxLines, Math.max(1, estimatedLines));
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
  queue: unknown,
  current: unknown,
  next: unknown,
): Set<string> {
  return new Set(getQueuedThoughts(queue, current, next).map((thought) => thought.id));
}

/**
 * Returns one de-duplicated FIFO queue. During a client/server rollout the
 * response may only contain current/next, so those aliases are intentionally
 * used when the complete queue is absent.
 */
export function getQueuedThoughts(
  queue: unknown,
  current: unknown,
  next: unknown,
): Thought[] {
  const isThought = (value: unknown): value is Thought => {
    if (typeof value !== "object" || value === null) return false;
    const candidate = value as Record<string, unknown>;
    const updatedAt = candidate.updatedAt;
    const updatedAtMs = updatedAt instanceof Date
      ? updatedAt.getTime()
      : typeof updatedAt === "string"
        ? Date.parse(updatedAt)
        : Number.NaN;
    return typeof candidate.id === "string"
      && typeof candidate.authorId === "string"
      && typeof candidate.content === "string"
      && typeof candidate.createdFrom === "string"
      && typeof candidate.status === "string"
      && Number.isFinite(updatedAtMs);
  };
  const source = [
    current,
    ...(Array.isArray(queue) ? queue : []),
    next,
  ].filter(isThought);
  const seen = new Set<string>();
  return source.filter((thought) => {
    if (seen.has(thought.id)) return false;
    seen.add(thought.id);
    return true;
  });
}

export function shouldRefetchQuestionQueue({
  userId,
  isLoading,
  isFetching,
  mutationPending,
}: {
  userId: string | null | undefined;
  isLoading: boolean;
  isFetching: boolean;
  mutationPending: boolean;
}): boolean {
  return Boolean(userId) && !isLoading && !isFetching && !mutationPending;
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

function stableHash(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export type QuestionPlacementAnchors = ReadonlyMap<string, string | null>;

/**
 * Keeps each non-current question attached to the same ordinary record for the
 * lifetime of one screen session. Only questions whose anchor disappeared are
 * assigned again; adding, activating, or deleting unrelated records does not
 * move the rest.
 */
export function resolveQuestionPlacementAnchors<T extends UnifiedRecord>(
  records: readonly T[],
  questionQueue: readonly T[],
  seed: string,
  previousAnchors: QuestionPlacementAnchors = new Map(),
): Map<string, string | null> {
  const questionIds = new Set(questionQueue.map((record) => record.id));
  const ordinaryIds = records
    .filter((record) => !questionIds.has(record.id))
    .sort(compareRecordsNewestFirst)
    .map((record) => record.id);
  const ordinaryIdSet = new Set(ordinaryIds);
  const anchors = new Map<string, string | null>();

  for (const question of questionQueue.slice(1)) {
    const previousAnchor = previousAnchors.get(question.id);
    if (previousAnchor && ordinaryIdSet.has(previousAnchor)) {
      anchors.set(question.id, previousAnchor);
      continue;
    }
    if (ordinaryIds.length === 0) {
      anchors.set(question.id, null);
      continue;
    }
    anchors.set(
      question.id,
      ordinaryIds[stableHash(`${seed}:${question.id}`) % ordinaryIds.length],
    );
  }
  return anchors;
}

/**
 * Builds date groups while mixing the complete question queue into ordinary
 * cards. The first queued question is always the first card of the newest
 * visible date group; remaining questions use a seed+ID slot so their
 * positions remain stable while the screen is mounted.
 *
 * Placement anchors are carried across data changes by the caller. Removing
 * or activating one item therefore does not reshuffle unrelated questions,
 * and duplicate IDs are defensively removed from both inputs.
 */
export function buildMixedRecordGroups<T extends UnifiedRecord>(
  records: T[],
  questionQueue: readonly T[] = [],
  seed = "",
  placementAnchors?: QuestionPlacementAnchors,
): RecordDateGroup<T>[] {
  const uniqueQuestions = questionQueue.filter((record, index, source) =>
    source.findIndex((candidate) => candidate.id === record.id) === index,
  );
  const queueIds = new Set(uniqueQuestions.map((record) => record.id));
  const dateGroups = buildRecordDateGroups(
    records.filter((record) => !queueIds.has(record.id)),
  );

  if (uniqueQuestions.length === 0) return dateGroups;

  if (dateGroups.length === 0) {
    const firstQuestion = uniqueQuestions[0];
    const dateKey = toKstCalendarDateKey(firstQuestion.updatedAt);
    return [{
      dateKey,
      label: formatRecordDateLabel(dateKey),
      records: uniqueQuestions,
    }];
  }

  const [currentQuestion, ...remainingQuestions] = uniqueQuestions;
  const anchors = placementAnchors ?? resolveQuestionPlacementAnchors(
    records,
    uniqueQuestions,
    seed,
  );
  const visibleOrdinaryIds = dateGroups.flatMap((group) =>
    group.records.map((record) => record.id),
  );
  const visibleOrdinaryIdSet = new Set(visibleOrdinaryIds);
  const insertions = new Map<string, T[]>();

  remainingQuestions
    .map((record, index) => ({
      record,
      index,
      rank: stableHash(`${seed}:${record.id}`),
    }))
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .forEach(({ record }) => {
      const persistentAnchor = anchors.get(record.id);
      const displayAnchor = persistentAnchor && visibleOrdinaryIdSet.has(persistentAnchor)
        ? persistentAnchor
        : visibleOrdinaryIds[stableHash(`${seed}:${record.id}`) % visibleOrdinaryIds.length];
      if (!displayAnchor) return;
      const bucket = insertions.get(displayAnchor);
      if (bucket) bucket.push(record);
      else insertions.set(displayAnchor, [record]);
    });

  const mixedGroups = dateGroups.map((group, groupIndex) => {
    const mixedRecords: T[] = [];
    for (const [recordIndex, record] of group.records.entries()) {
      if (groupIndex === 0 && recordIndex === 0) mixedRecords.push(currentQuestion);
      mixedRecords.push(record);
      mixedRecords.push(...(insertions.get(record.id) ?? []));
    }
    return { ...group, records: mixedRecords };
  });

  return mixedGroups;
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
  const titleDisplay = hasTitle ? normalizePreviewTitle(tokensToPlainText(firstBlock.tokens)) : "";
  const title = normalizePreviewText(titleDisplay);
  const bodyBlocks = hasTitle ? blocks.slice(1) : blocks;
  const body = normalizePreviewText(
    bodyBlocks.map((block) => tokensToPlainText(block.tokens)).join("\n"),
  );

  return { title, titleDisplay, body, hasTitle: Boolean(title) };
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
  const title = hasTitle ? normalizePreviewTitle(tokensToPlainText(firstBlock.tokens)) : "";
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
