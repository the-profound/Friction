import { ApiError, type Article, type Thought } from "@workspace/api-client-react";
import {
  parseMarkdownBlocks,
  tokensToPlainText,
  type MarkdownBlockType,
} from "../utils/markdownParser";
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

export interface RecordFocusPosition {
  groupIndex: number;
  cardIndex: number;
  contentIndex: number;
}

export function findRecordFocusPosition<T extends UnifiedRecord>(
  recordId: string,
  cardGroups: readonly RecordDateGroup<T>[],
  contentRecords: readonly T[],
): RecordFocusPosition | null {
  const contentIndex = contentRecords.findIndex((record) => record.id === recordId);
  for (let groupIndex = 0; groupIndex < cardGroups.length; groupIndex += 1) {
    const cardIndex = cardGroups[groupIndex].records.findIndex((record) => record.id === recordId);
    if (cardIndex >= 0) return { groupIndex, cardIndex, contentIndex };
  }
  return contentIndex >= 0 ? { groupIndex: -1, cardIndex: -1, contentIndex } : null;
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
  bodyBlocks: MarkdownBlockType[];
  hasTitle: boolean;
}

export const RECORD_CARD_TITLE_MAX_LINES = 2;
export type RecordSortKey = {
  id: string;
  createdAt?: string | Date;
  updatedAt: string | Date;
  thought?: Pick<Thought, "createdAt">;
  article?: Pick<Article, "createdAt">;
};

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
export function getRecordOrderAt(record: RecordSortKey): number {
  const createdAt = record.thought?.createdAt ?? record.article?.createdAt ?? record.createdAt;
  return new Date(createdAt ?? record.updatedAt).getTime();
}

export function compareRecordsNewestFirst(a: RecordSortKey, b: RecordSortKey): number {
  const timeDiff = getRecordOrderAt(b) - getRecordOrderAt(a);
  return timeDiff || b.id.localeCompare(a.id);
}

/**
 * Reconcile a newly fetched snapshot without allowing response timing to
 * reshuffle rows that have already been placed in this screen session.
 *
 * Incoming IDs are authoritative for deletion, incoming snapshots replace the
 * row contents, and genuinely new rows are prepended using the canonical
 * record comparator. Repeated IDs are collapsed before placement.
 */
export function mergeRecordSession(
  previous: readonly UnifiedRecord[],
  incoming: readonly UnifiedRecord[],
): UnifiedRecord[] {
  const incomingById = new Map<string, UnifiedRecord>();
  for (const record of incoming) {
    const current = incomingById.get(record.id);
    if (!current || compareRecordsNewestFirst(record, current) < 0) {
      incomingById.set(record.id, record);
    }
  }

  if (previous.length === 0) {
    return [...incomingById.values()].sort(compareRecordsNewestFirst);
  }

  const placedIds = new Set<string>();
  const placed = previous.flatMap((record) => {
    const latest = incomingById.get(record.id);
    if (!latest || placedIds.has(record.id)) return [];
    placedIds.add(record.id);
    return [latest];
  });
  const added = [...incomingById.values()]
    .filter((record) => !placedIds.has(record.id))
    .sort(compareRecordsNewestFirst);

  return [...added, ...placed];
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

  return mergeRecordSession([], [...thoughtRecords, ...articleRecords]);
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

/**
 * True when a thought's own fields mark it as an unanswered entry still
 * sitting in the server-owned question queue. Both server insert paths that
 * populate the queue (random fallback and AI generation) create the thought
 * with `createdFrom: "question"`, `status: "PRELIMINARY"`, and no
 * sourceArticleId; activation flips status to "NORMAL" and removes the queue
 * row. The reading screen's in-context "answer this question" flow also
 * writes `createdFrom: "question"` thoughts, but always with a
 * sourceArticleId — those are finished, first-class thoughts, not queue
 * placeholders, so the sourceArticleId check keeps them out of this bucket.
 *
 * This lets the ordinary thought list hide a still-queued question even when
 * the queue endpoint itself fails to respond: the two signals (this check and
 * the queue response's ID set) are combined, never substituted for one
 * another, so a successful queue fetch keeps behaving exactly as before.
 */
export function isPendingQueueQuestionThought(
  thought: Pick<Thought, "createdFrom" | "status" | "sourceArticleId">,
): boolean {
  return (
    thought.createdFrom === "question"
    && thought.status === "PRELIMINARY"
    && thought.sourceArticleId == null
  );
}

export type QuestionErrorKind = "timeout" | "network" | "auth" | "unsupported" | "server" | "unknown";

/**
 * Maps a raw question-queue query error to a coarse failure bucket so the UI
 * can surface a cause-specific message. Keeps all PII out of logic (no
 * logging here).
 *
 * The question-queue GET handler always answers 200 with a snapshot — it
 * never sends its own 404. A 404 on this specific endpoint can therefore only
 * mean the server build the client is talking to does not expose the route
 * at all (an app/server version mismatch), so it is classified as
 * "unsupported" rather than a generic server error, and the UI must not
 * suggest retrying for it.
 */
export function classifyQuestionError(error: unknown): QuestionErrorKind {
  if (!error) return "unknown";
  if (error instanceof Error) {
    if (error.name === "TimeoutError" || error.name === "AbortError") return "timeout";
    // React Native: "Network request failed"; browser: "Failed to fetch"
    if (
      error instanceof TypeError ||
      error.message.toLowerCase().includes("network") ||
      error.message.toLowerCase().includes("failed to fetch")
    )
      return "network";
  }
  if (error instanceof ApiError) {
    if (error.status === 401 || error.status === 403) return "auth";
    if (error.status === 404) return "unsupported";
    if (error.status >= 500) return "server";
  }
  return "unknown";
}

/**
 * Single source of copy for a failed question-queue load, shared by the
 * empty-state title and the failure toast so the two can never drift apart
 * for the same cause. "unsupported" intentionally omits retry wording —
 * pulling to refresh cannot fix a server build that lacks the route.
 */
export function getQuestionUnavailableMessage(kind: QuestionErrorKind): string {
  switch (kind) {
    case "timeout":
      return "연결 시간이 초과됐어요. 화면을 당겨 다시 시도해주세요.";
    case "network":
      return "네트워크에 연결되지 않았어요. 연결을 확인한 뒤 화면을 당겨 새로고침해주세요.";
    case "auth":
      return "로그인이 만료됐어요. 화면을 당겨 다시 시도해주세요.";
    case "unsupported":
      return "서버와 앱 버전이 맞지 않아요. 앱을 최신 버전으로 업데이트해주세요.";
    case "server":
    case "unknown":
    default:
      return "질문을 불러오지 못했어요. 화면을 당겨 다시 시도해주세요.";
  }
}

/**
 * Decides whether another question-queue failure should raise another toast.
 * Repeated failures of the same kind (e.g. every retry while offline) must
 * not stack duplicate toasts. Callers reset `lastShownErrorKind` to null on
 * the next success, so a later failure — even the same kind — shows again.
 */
export function shouldShowQuestionErrorToast(
  errorKind: QuestionErrorKind,
  lastShownErrorKind: QuestionErrorKind | null,
): boolean {
  return errorKind !== lastShownErrorKind;
}

export function shouldRefetchQuestionQueue({
  userId,
  authIsLoading = false,
  isLoading,
  isFetching,
  mutationPending,
}: {
  userId: string | null | undefined;
  /** When true, auth restore is still in progress and the request would fire
   *  without a valid token. Suppress all refetch attempts until auth settles. */
  authIsLoading?: boolean;
  isLoading: boolean;
  isFetching: boolean;
  mutationPending: boolean;
}): boolean {
  return Boolean(userId) && !authIsLoading && !isLoading && !isFetching && !mutationPending;
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
export function buildRecordDateGroups<T extends UnifiedRecord>(
  records: T[],
  options: { preserveRecordOrder?: boolean } = {},
): RecordDateGroup<T>[] {
  const grouped = new Map<string, T[]>();
  const orderedRecords = options.preserveRecordOrder
    ? records
    : [...records].sort(compareRecordsNewestFirst);

  for (const record of orderedRecords) {
    const recordDate =
      record.kind === "thought" ? record.thought.createdAt : record.article.createdAt;
    const dateKey = toKstCalendarDateKey(
      recordDate ?? record.updatedAt,
    );
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
  options: { preserveRecordOrder?: boolean } = {},
): RecordDateGroup<T>[] {
  const uniqueQuestions = questionQueue.filter((record, index, source) =>
    source.findIndex((candidate) => candidate.id === record.id) === index,
  );
  const queueIds = new Set(uniqueQuestions.map((record) => record.id));
  const dateGroups = buildRecordDateGroups(
    records.filter((record) => !queueIds.has(record.id)),
    options,
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
  const body = normalizeDisplayLineEndings(record.article.content);
  return {
    title,
    body,
    bodyBlocks: parseMarkdownBlocks(body),
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
    bodyBlocks,
    hasTitle: Boolean(title),
  };
}
