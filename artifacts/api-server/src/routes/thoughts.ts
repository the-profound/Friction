import { Router, type IRouter } from "express";
import {
  and,
  asc,
  desc,
  eq,
  inArray,
  isNotNull,
  isNull,
  ne,
  notExists,
  sql,
} from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  articlesTable,
  thoughtPromotionsTable,
  thoughtQuestionQueueTable,
  thoughtQuestionSourcesTable,
  thoughtsTable,
  type ThoughtStatus,
} from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import {
  CreateThoughtBody,
  PromoteThoughtBody,
  UpdateThoughtBody,
  isMeaningfulThoughtMarkdown,
} from "@workspace/api-zod";
import {
  generateDenseEmbedding,
  generateSparseEmbedding,
} from "../lib/embeddings";
import { analyzeThoughtExpansion } from "../services/analyze-thought-expansion";
import { generatePreliminaryThoughtQuestion } from "../services/generate-preliminary-thought-question";
import { generateRandomPreliminaryThoughtQuestion } from "../services/generate-random-preliminary-thought-question";
import {
  formatPreliminaryQuestionMarkdown,
  isQuestionThoughtMarkdown,
} from "../services/preliminary-question-format";
import { getThoughtCreateRetryAction } from "../lib/thoughtCreateIdempotency";

const router: IRouter = Router();

type ThoughtMarkdown = {
  title: string;
  body: string;
};

// A bounded backlog lets the archive browse questions continuously without
// letting display retries trigger unbounded AI work.
const QUESTION_QUEUE_TARGET_SIZE = 6;
const QUESTION_QUEUE_MIN_SIZE = 3;
const QUESTION_QUEUE_SOURCE_CANDIDATE_LIMIT = QUESTION_QUEUE_TARGET_SIZE * 3;

type ThoughtRow = typeof thoughtsTable.$inferSelect;
const questionSourceThought = alias(thoughtsTable, "question_source_thought");

async function lockQuestionQueue(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
) {
  // Queue mutations for one user must serialize. This prevents concurrent
  // display/refresh retries from creating two "next" questions.
  await tx.execute(
    sql`SELECT pg_advisory_xact_lock(hashtext(${`thought-question-queue:${userId}`}))`,
  );
}

async function getQueuedQuestions(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
): Promise<Array<{ queueId: string; position: number; thought: ThoughtRow }>> {
  const rows = await tx
    .select({
      queueId: thoughtQuestionQueueTable.id,
      position: thoughtQuestionQueueTable.position,
      thought: thoughtsTable,
    })
    .from(thoughtQuestionQueueTable)
    .innerJoin(
      thoughtsTable,
      eq(thoughtQuestionQueueTable.thoughtId, thoughtsTable.id),
    )
    .where(
      and(
        eq(thoughtQuestionQueueTable.userId, userId),
        eq(thoughtsTable.authorId, userId),
        eq(thoughtsTable.status, "PRELIMINARY"),
        isNull(thoughtsTable.deletedAt),
      ),
    )
    .orderBy(asc(thoughtQuestionQueueTable.position));

  return rows;
}

async function queueSnapshot(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
) {
  const rows = await getQueuedQuestions(tx, userId);
  return {
    current: rows[0]?.thought ?? null,
    next: rows[1]?.thought ?? null,
    queue: rows.map((row) => row.thought),
  };
}

async function cleanupQuestionQueue(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
) {
  // Defensive cleanup for rows left by an older client or a soft-deleted/
  // activated thought. Callers hold the per-user advisory lock.
  await tx.execute(sql`
    DELETE FROM thought_question_queue AS queue
    WHERE queue.user_id = ${userId}
      AND NOT EXISTS (
        SELECT 1
        FROM thoughts AS thought
        WHERE thought.id = queue.thought_id
          AND thought.author_id = ${userId}
          AND thought.status = 'PRELIMINARY'
          AND thought.deleted_at IS NULL
      )
  `);
}

async function trimQuestionQueue(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  queued: Awaited<ReturnType<typeof getQueuedQuestions>>,
) {
  const retained = queued.slice(0, QUESTION_QUEUE_TARGET_SIZE);
  const overflow = queued.slice(QUESTION_QUEUE_TARGET_SIZE);
  if (overflow.length === 0) return retained;

  const deletedAt = new Date();
  for (const entry of overflow) {
    await tx
      .delete(thoughtQuestionQueueTable)
      .where(eq(thoughtQuestionQueueTable.id, entry.queueId));
    await tx
      .update(thoughtsTable)
      .set({ deletedAt })
      .where(
        and(
          eq(thoughtsTable.id, entry.thought.id),
          eq(thoughtsTable.authorId, userId),
          eq(thoughtsTable.status, "PRELIMINARY"),
          eq(thoughtsTable.createdFrom, "question"),
        ),
      );
  }
  return retained;
}

async function normalizeQuestionQueue(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
) {
  await cleanupQuestionQueue(tx, userId);
  return trimQuestionQueue(tx, userId, await getQueuedQuestions(tx, userId));
}

// ——— Background AI generation guard and drain helper ———

/** Per-user lock: at most one background AI generation pass runs per user at a time. */
const bgGenerationLock = new Set<string>();

/**
 * Pending background generation promises, tracked solely so integration tests can
 * drain all in-flight work before making assertions. Never awaited in production.
 */
const _pendingBgTasks: Promise<void>[] = [];

/**
 * Await all in-flight background generation tasks.
 * Intended for integration tests only — not called in production paths.
 */
export async function _drainBackgroundGenerations(): Promise<void> {
  const batch = _pendingBgTasks.splice(0);
  if (batch.length > 0) await Promise.all(batch);
}

// ——— Three-phase queue fill helpers (AI calls outside DB transactions) ———

type SourceCandidate = {
  id: string;
  content: string;
  sourceArticleId: string | null;
  sourceStoredSentenceId: string | null;
};

type AIQuestionResult = {
  generated: { title: string; description: string };
  selectedSources: SourceCandidate[];
};

/**
 * Read source candidates inside a short transaction.
 * Does not call the AI; purely reads DB state.
 */
async function readCandidates(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  currentQueueLength: number,
): Promise<{ sourceCandidates: SourceCandidate[]; needed: number }> {
  const needed = QUESTION_QUEUE_TARGET_SIZE - currentQueueLength;
  if (needed <= 0) return { sourceCandidates: [], needed: 0 };

  const candidates = await tx
    .select({
      id: thoughtsTable.id,
      content: thoughtsTable.content,
      sourceArticleId: thoughtsTable.sourceArticleId,
      sourceStoredSentenceId: thoughtsTable.sourceStoredSentenceId,
    })
    .from(thoughtsTable)
    .where(
      and(
        eq(thoughtsTable.authorId, userId),
        eq(thoughtsTable.status, "NORMAL"),
        ne(thoughtsTable.createdFrom, "question"),
        isNull(thoughtsTable.deletedAt),
        isNotNull(thoughtsTable.content),
        notExists(
          tx
            .select({ id: thoughtQuestionSourcesTable.id })
            .from(thoughtQuestionSourcesTable)
            .innerJoin(
              questionSourceThought,
              eq(
                thoughtQuestionSourcesTable.questionThoughtId,
                questionSourceThought.id,
              ),
            )
            .where(
              and(
                eq(
                  thoughtQuestionSourcesTable.sourceThoughtId,
                  thoughtsTable.id,
                ),
                eq(questionSourceThought.authorId, userId),
              ),
            ),
        ),
      ),
    )
    .orderBy(desc(thoughtsTable.updatedAt))
    .limit(QUESTION_QUEUE_SOURCE_CANDIDATE_LIMIT);

  const sourceCandidates = candidates.filter(
    (candidate): candidate is typeof candidate & { content: string } =>
      !!candidate.content?.trim() &&
      !isQuestionThoughtMarkdown(candidate.content),
  );

  return { sourceCandidates, needed };
}

/**
 * Fill the question queue up to QUESTION_QUEUE_MIN_SIZE using random fallback questions.
 * No AI calls — runs entirely inside a short DB transaction.
 * Returns the extended queue (unchanged if already at or above the floor).
 */
async function fillFallbackToMinimum(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  queued: Awaited<ReturnType<typeof getQueuedQuestions>>,
): Promise<Awaited<ReturnType<typeof getQueuedQuestions>>> {
  if (queued.length >= QUESTION_QUEUE_MIN_SIZE) return queued;
  const existingTitles = new Set(
    queued
      .map((entry) => getQuestionTitle(entry.thought.content))
      .filter((t): t is string => Boolean(t)),
  );
  let current = [...queued];
  while (current.length < QUESTION_QUEUE_MIN_SIZE) {
    const generated = generateRandomPreliminaryThoughtQuestion(existingTitles);
    if (!generated) break;
    const [question] = await tx
      .insert(thoughtsTable)
      .values({
        authorId: userId,
        content: formatPreliminaryQuestionMarkdown(generated.title, generated.description),
        createdFrom: "question",
        status: "PRELIMINARY",
      })
      .returning();
    const lastPosition = current.at(-1)?.position ?? -1;
    const [queueRow] = await tx
      .insert(thoughtQuestionQueueTable)
      .values({ userId, thoughtId: question.id, position: lastPosition + 1 })
      .returning({ id: thoughtQuestionQueueTable.id, position: thoughtQuestionQueueTable.position });
    current = [
      ...current,
      { queueId: queueRow.id, position: queueRow.position, thought: question },
    ];
    existingTitles.add(generated.title);
  }
  return current;
}

/** Maximum wall-clock time for all AI calls within one background generation pass. */
const BACKGROUND_AI_TOTAL_TIMEOUT_MS = 90_000;

type RequestLogger = {
  info(obj: object | string, msg?: string): void;
  warn(obj: object | string, msg?: string): void;
};

/**
 * Run AI question generation in the background, write results, then clear the per-user lock.
 * Never throws — all errors are caught and logged so the lock is always released.
 */
async function runBackgroundGeneration(
  userId: string,
  sourceCandidates: SourceCandidate[],
  needed: number,
  log?: RequestLogger,
): Promise<void> {
  const start = Date.now();
  try {
    const deadline = start + BACKGROUND_AI_TOTAL_TIMEOUT_MS;
    const sourceGroups = Array.from({ length: needed }, (_, index) =>
      sourceCandidates.slice(index * 3, index * 3 + 3),
    ).filter((sources) => sources.length > 0);

    const aiResults: AIQuestionResult[] = [];
    for (const selectedSources of sourceGroups) {
      if (Date.now() >= deadline) {
        log?.warn(
          { elapsed: Date.now() - start },
          "[question-queue] background AI deadline reached — partial results saved",
        );
        break;
      }
      let generated;
      try {
        generated = await generatePreliminaryThoughtQuestion(selectedSources);
      } catch (err) {
        log?.warn(
          { err, elapsed: Date.now() - start },
          "[question-queue] background AI call failed",
        );
        break;
      }
      if (!generated) break;
      aiResults.push({ generated, selectedSources });
    }

    if (aiResults.length > 0) {
      await db.transaction(async (tx) => {
        await lockQuestionQueue(tx, userId);
        const queued = await normalizeQuestionQueue(tx, userId);
        await writeGeneratedQuestions(tx, userId, aiResults, queued);
      });
    }

    log?.info(
      { elapsed: Date.now() - start, count: aiResults.length },
      "[question-queue] background generation complete",
    );
  } catch (err) {
    log?.warn(
      { err, elapsed: Date.now() - start },
      "[question-queue] background generation error",
    );
  } finally {
    bgGenerationLock.delete(userId);
  }
}

/**
 * Schedule a non-blocking background AI generation pass for this user.
 * No-ops if a pass is already running for the same user.
 */
function scheduleBackgroundGeneration(
  userId: string,
  sourceCandidates: SourceCandidate[],
  needed: number,
  log?: RequestLogger,
): void {
  if (bgGenerationLock.has(userId)) {
    log?.info(
      "[question-queue] background generation already running — skipping duplicate",
    );
    return;
  }
  bgGenerationLock.add(userId);
  const task = runBackgroundGeneration(userId, sourceCandidates, needed, log);
  _pendingBgTasks.push(task);
  // Fire-and-forget in production; the guard is cleared inside runBackgroundGeneration.
  task.catch(() => bgGenerationLock.delete(userId));
}

/**
 * Run AI question generation with no DB connection held.
 * Non-fatal on error or null response: returns only successfully generated items.
 */
async function generateAIQuestions(
  sourceCandidates: SourceCandidate[],
  needed: number,
): Promise<AIQuestionResult[]> {
  const sourceGroups = Array.from({ length: needed }, (_, index) =>
    sourceCandidates.slice(index * 3, index * 3 + 3),
  ).filter((sources) => sources.length > 0);

  const results: AIQuestionResult[] = [];
  for (const selectedSources of sourceGroups) {
    let generated;
    try {
      generated = await generatePreliminaryThoughtQuestion(selectedSources);
    } catch {
      break;
    }
    if (!generated) break;
    results.push({ generated, selectedSources });
  }
  return results;
}

/**
 * Write AI-generated and random-fallback questions in a short transaction.
 * Takes the caller-supplied post-normalize queue state so only as many AI
 * results as still fit within the target are inserted (guards against
 * concurrent fills between the read and write transactions).
 */
async function writeGeneratedQuestions(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
  aiResults: AIQuestionResult[],
  queued: Awaited<ReturnType<typeof getQueuedQuestions>>,
): Promise<void> {
  const stillNeeded = QUESTION_QUEUE_TARGET_SIZE - queued.length;
  let resultsToWrite = aiResults.slice(0, stillNeeded);

  // Guard against concurrent fills that happened between Phase 1 and Phase 3:
  // re-read the provenance table under the advisory lock and discard any AI
  // result whose sources were already consumed by another request.
  if (resultsToWrite.length > 0) {
    const allSourceIds = resultsToWrite.flatMap(({ selectedSources }) =>
      selectedSources.map((s) => s.id),
    );
    if (allSourceIds.length > 0) {
      const nowUsed = await tx
        .select({ sourceThoughtId: thoughtQuestionSourcesTable.sourceThoughtId })
        .from(thoughtQuestionSourcesTable)
        .innerJoin(
          questionSourceThought,
          eq(
            thoughtQuestionSourcesTable.questionThoughtId,
            questionSourceThought.id,
          ),
        )
        .where(
          and(
            inArray(thoughtQuestionSourcesTable.sourceThoughtId, allSourceIds),
            eq(questionSourceThought.authorId, userId),
          ),
        );
      const nowUsedSet = new Set(
        nowUsed
          .map((r) => r.sourceThoughtId)
          .filter((id): id is string => id !== null),
      );
      resultsToWrite = resultsToWrite.filter(({ selectedSources }) =>
        selectedSources.every((s) => !nowUsedSet.has(s.id)),
      );
    }
  }

  for (const { generated, selectedSources } of resultsToWrite) {
    const [question] = await tx
      .insert(thoughtsTable)
      .values({
        authorId: userId,
        content: formatPreliminaryQuestionMarkdown(
          generated.title,
          generated.description,
        ),
        createdFrom: "question",
        status: "PRELIMINARY",
      })
      .returning();

    const provenance = [
      ...selectedSources.map((source) => ({
        questionThoughtId: question.id,
        sourceThoughtId: source.id,
      })),
      ...Array.from(
        new Set(
          selectedSources
            .map((source) => source.sourceArticleId)
            .filter(Boolean),
        ),
      ).map((sourceArticleId) => ({
        questionThoughtId: question.id,
        sourceArticleId: sourceArticleId!,
      })),
      ...Array.from(
        new Set(
          selectedSources
            .map((source) => source.sourceStoredSentenceId)
            .filter(Boolean),
        ),
      ).map((sourceStoredSentenceId) => ({
        questionThoughtId: question.id,
        sourceStoredSentenceId: sourceStoredSentenceId!,
      })),
    ];
    if (provenance.length > 0)
      await tx.insert(thoughtQuestionSourcesTable).values(provenance);

    const lastPosition = queued.at(-1)?.position ?? -1;
    const [queueRow] = await tx
      .insert(thoughtQuestionQueueTable)
      .values({ userId, thoughtId: question.id, position: lastPosition + 1 })
      .returning({
        id: thoughtQuestionQueueTable.id,
        position: thoughtQuestionQueueTable.position,
      });
    queued = [
      ...queued,
      { queueId: queueRow.id, position: queueRow.position, thought: question },
    ];
  }

  // Synchronous random fallback: fill up to the minimum backlog without AI.
  const existingQuestionTitles = new Set(
    queued
      .map((entry) => getQuestionTitle(entry.thought.content))
      .filter((title): title is string => Boolean(title)),
  );
  while (queued.length < QUESTION_QUEUE_MIN_SIZE) {
    const generated = generateRandomPreliminaryThoughtQuestion(
      existingQuestionTitles,
    );
    if (!generated) break;

    const [question] = await tx
      .insert(thoughtsTable)
      .values({
        authorId: userId,
        content: formatPreliminaryQuestionMarkdown(
          generated.title,
          generated.description,
        ),
        createdFrom: "question",
        status: "PRELIMINARY",
      })
      .returning();

    const lastPosition = queued.at(-1)?.position ?? -1;
    const [queueRow] = await tx
      .insert(thoughtQuestionQueueTable)
      .values({ userId, thoughtId: question.id, position: lastPosition + 1 })
      .returning({
        id: thoughtQuestionQueueTable.id,
        position: thoughtQuestionQueueTable.position,
      });
    queued = [
      ...queued,
      { queueId: queueRow.id, position: queueRow.position, thought: question },
    ];
    existingQuestionTitles.add(generated.title);
  }
}

async function compactQuestionQueue(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
) {
  // Move to a disjoint negative range first so the per-user unique position
  // index is never temporarily violated while the FIFO positions are compacted.
  await tx.execute(sql`
    UPDATE thought_question_queue
    SET position = -position - 1
    WHERE user_id = ${userId}
  `);
  await tx.execute(sql`
    WITH ordered AS (
      SELECT id, row_number() OVER (ORDER BY position DESC) - 1 AS next_position
      FROM thought_question_queue
      WHERE user_id = ${userId}
    )
    UPDATE thought_question_queue AS queue
    SET position = ordered.next_position
    FROM ordered
    WHERE queue.id = ordered.id
  `);
}

/**
 * A writing-stage thought stores its title as the first Markdown H1. Keeping
 * this rule on the server prevents clients from creating an article with a
 * title that cannot be represented by the thought record.
 */
export function parseThoughtMarkdown(markdown: string): ThoughtMarkdown | null {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const match = /^ {0,3}#(?!#)[ \t]+(.*)$/.exec(lines[0] ?? "");
  if (!match) return null;

  const titleLines = [match[1]];
  let cursor = 1;
  while (cursor < lines.length) {
    const previous = titleLines[titleLines.length - 1];
    if (!/[ \t]{2,}$/.test(previous) || lines[cursor].trim() === "") break;
    titleLines[titleLines.length - 1] = previous.replace(/[ \t]{2,}$/, "");
    titleLines.push(lines[cursor]);
    cursor += 1;
  }
  titleLines[titleLines.length - 1] = titleLines[titleLines.length - 1].replace(
    /[ \t]{2,}$/,
    "",
  );

  const title = titleLines
    .map((line) => {
      const escapedCharacters: string[] = [];
      const protectedLine = line.replace(
        /\\([\\!"#$%&'()*+,\-./:;<=>?@\[\]^_`{|}~])/g,
        (_match, character: string) => {
          const token = `\uE000${escapedCharacters.length}\uE001`;
          escapedCharacters.push(character);
          return token;
        },
      );
      return protectedLine
        .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
        .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
        .replace(/<\/?u>/gi, "")
        .replace(/[*_~`]+/g, "")
        .trim()
        .replace(/&#(\d+);/g, (match, codePoint: string) => {
          const value = Number(codePoint);
          return Number.isInteger(value) && value >= 0 && value <= 0x10ffff
            ? String.fromCodePoint(value)
            : match;
        })
        .replace(
          /\uE000(\d+)\uE001/g,
          (_match, index: string) => escapedCharacters[Number(index)] ?? "",
        );
    })
    .join("\n");
  const body = lines.slice(cursor).join("\n").replace(/^\n/, "");
  if (!title.trim() || !body.trim()) return null;
  return { title, body };
}

/**
 * Article titles live outside the Markdown body while a write is in review.
 * When returning to a thought, encode every title line as one H1 with Markdown
 * hard breaks so a later promotion reconstructs the exact title.
 */
export function formatThoughtMarkdown(title: string, body: string): string {
  const normalizedTitle = title.replace(/\r\n?/g, "\n");
  const normalizedBody = body.replace(/\r\n?/g, "\n");
  const titleMarkdown = normalizedTitle
    .split("\n")
    .map((line) => {
      const escaped = line.replace(
        /([\\!"#$%&'()*+,\-./:;<=>?@\[\]^_`{|}~])/g,
        "\\$1",
      );
      return escaped.replace(/^\s+|\s+$/g, (whitespace) =>
        [...whitespace]
          .map((character) => `&#${character.codePointAt(0)};`)
          .join(""),
      );
    })
    .join("  \n");
  return `# ${titleMarkdown}\n\n${normalizedBody}`;
}

type TransitionSnapshot = {
  title: string;
  content: string;
  expectedUpdatedAt: Date;
  requestId?: string;
};

export function validateTransitionSnapshot(data: {
  title?: string;
  content?: string;
  expectedUpdatedAt?: string;
}):
  | { snapshot: TransitionSnapshot }
  | { error: string; code: "INVALID_SNAPSHOT" }
  | null {
  const hasSnapshotField =
    data.title !== undefined ||
    data.content !== undefined ||
    data.expectedUpdatedAt !== undefined;
  if (!hasSnapshotField) return null;

  if (
    data.title === undefined ||
    data.content === undefined ||
    data.expectedUpdatedAt === undefined
  ) {
    return {
      error: "title, content, and expectedUpdatedAt must be supplied together",
      code: "INVALID_SNAPSHOT",
    };
  }
  if (!data.title.trim()) {
    return {
      error: "Snapshot title must not be empty",
      code: "INVALID_SNAPSHOT",
    };
  }
  if (
    data.title
      .replace(/\r\n?/g, "\n")
      .split("\n")
      .some((line) => line.trim() === "")
  ) {
    return {
      error: "Snapshot title cannot contain an empty line",
      code: "INVALID_SNAPSHOT",
    };
  }
  const expectedUpdatedAt = new Date(data.expectedUpdatedAt);
  if (!Number.isFinite(expectedUpdatedAt.getTime())) {
    return {
      error: "expectedUpdatedAt must be a valid ISO timestamp",
      code: "INVALID_SNAPSHOT",
    };
  }
  if (
    !data.content.trim() ||
    !isMeaningfulThoughtMarkdown(data.content) ||
    !isMeaningfulThoughtMarkdown(
      formatThoughtMarkdown(data.title, data.content),
    )
  ) {
    return {
      error: "Snapshot content must include text or an image",
      code: "INVALID_SNAPSHOT",
    };
  }

  return {
    snapshot: {
      title: data.title,
      content: data.content,
      expectedUpdatedAt,
    },
  };
}

function getQuestionTitle(markdown: string | null): string | null {
  const title = markdown
    ?.split(/\r?\n/, 1)[0]
    ?.trim()
    .replace(/^#\s+Q\.\s*/i, "");
  return title || null;
}

router.get("/thoughts/:id/similar", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const limit = Math.max(
    1,
    Math.min(parseInt(String(req.query.limit ?? "15"), 10) || 15, 100),
  );

  const [source] = await db
    .select({
      id: thoughtsTable.id,
      content: thoughtsTable.content,
      textEmbeddingDense: thoughtsTable.textEmbeddingDense,
    })
    .from(thoughtsTable)
    .where(
      and(
        eq(thoughtsTable.id, id),
        eq(thoughtsTable.authorId, userId),
        isNull(thoughtsTable.deletedAt),
      ),
    );

  if (!source) {
    res.status(404).json({ error: "Thought not found" });
    return;
  }

  if (!source.textEmbeddingDense) {
    res.json([]);
    return;
  }

  const vectorLiteral = `[${source.textEmbeddingDense.join(",")}]`;

  const similar = await db
    .select({
      id: thoughtsTable.id,
      authorId: thoughtsTable.authorId,
      content: thoughtsTable.content,
      createdFrom: thoughtsTable.createdFrom,
      sourceArticleId: thoughtsTable.sourceArticleId,
      sourceStoredSentenceId: thoughtsTable.sourceStoredSentenceId,
      status: thoughtsTable.status,
      migratedFromArticleId: thoughtsTable.migratedFromArticleId,
      createdAt: thoughtsTable.createdAt,
      updatedAt: thoughtsTable.updatedAt,
    })
    .from(thoughtsTable)
    .where(
      and(
        eq(thoughtsTable.authorId, userId),
        isNull(thoughtsTable.deletedAt),
        ne(thoughtsTable.id, id),
        isNotNull(thoughtsTable.textEmbeddingDense),
      ),
    )
    .orderBy(sql`text_embedding_dense <=> ${vectorLiteral}::vector`)
    .limit(limit);

  if (similar.length === 0) {
    res.json([]);
    return;
  }

  const nullAnalysis = { r: null, k: null, h: null };
  let analysisMap: Record<
    string,
    { r: string | null; k: string[] | null; h: string[] | null }
  > = {};

  if (source.content && process.env.OPENROUTER_API_KEY) {
    try {
      const candidates = similar
        .filter((s) => s.content != null)
        .map((s) => ({ id: s.id, content: s.content! }));

      if (candidates.length > 0) {
        const results = await analyzeThoughtExpansion(
          { id: source.id, content: source.content },
          candidates,
        );
        for (const result of results) {
          analysisMap[result.id] = { r: result.r, k: result.k, h: result.h };
        }
      }
    } catch (err) {
      req.log?.warn(
        { err },
        "[thoughts/similar] AI analysis failed — returning null r/k/h",
      );
    }
  }

  const response = similar.map((s) => ({
    ...s,
    ...(analysisMap[s.id] ?? nullAnalysis),
  }));

  res.json(response);
});

router.get("/thoughts/question-queue", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const start = Date.now();

  // Single short transaction: normalize, fill minimum fallback synchronously (no AI wait),
  // snapshot, and read candidates for the background AI pass.
  const { snapshot, sourceCandidates, needed } = await db.transaction(async (tx) => {
    await lockQuestionQueue(tx, userId);
    const normalized = await normalizeQuestionQueue(tx, userId);
    // Always guarantee at least QUESTION_QUEUE_MIN_SIZE questions before responding.
    const queued = await fillFallbackToMinimum(tx, userId, normalized);
    // Determine how many more slots remain for background AI (up to TARGET).
    const { sourceCandidates, needed } = await readCandidates(tx, userId, queued.length);
    const snapshot = await queueSnapshot(tx, userId);
    return { snapshot, sourceCandidates, needed };
  });

  // Respond immediately — AI generation must never block this response.
  req.log?.info({ elapsed: Date.now() - start }, "[question-queue] GET response time ms");
  res.json(snapshot);

  // Background: fill remaining slots up to TARGET_SIZE with AI questions.
  // Deduplicated per user — concurrent requests share one background pass.
  if (needed > 0 && sourceCandidates.length > 0) {
    scheduleBackgroundGeneration(
      userId,
      sourceCandidates,
      needed,
      req.log as RequestLogger | undefined,
    );
  }
});

router.post(
  "/thoughts/question-queue/refresh",
  requireAuth,
  async (req, res) => {
    const userId = req.user!.id;
    const currentThoughtId = (req.body as Record<string, unknown> | undefined)
      ?.currentThoughtId;
    if (typeof currentThoughtId !== "string") {
      res.status(400).json({ error: "currentThoughtId must be a UUID string" });
      return;
    }

    // Phase 1: Short transaction — lock, normalize, requeue the current card,
    // compact positions, and read source candidates for the AI phase.
    type Phase1Result =
      | { requeued: false; snapshot: Awaited<ReturnType<typeof queueSnapshot>> }
      | { requeued: true; sourceCandidates: SourceCandidate[]; needed: number };

    const phase1: Phase1Result = await db.transaction(async (tx) => {
      await lockQuestionQueue(tx, userId);
      const before = await normalizeQuestionQueue(tx, userId);
      const current = before[0];
      if (!current || current.thought.id !== currentThoughtId) {
        return {
          requeued: false as const,
          snapshot: await queueSnapshot(tx, userId),
        };
      }

      await cleanupQuestionQueue(tx, userId);
      const lastPosition = before.at(-1)?.position ?? current.position;
      await tx
        .update(thoughtQuestionQueueTable)
        .set({ position: lastPosition + 1 })
        .where(eq(thoughtQuestionQueueTable.id, current.queueId));
      await compactQuestionQueue(tx, userId);

      // Queue count is unchanged after the move (current card was not deleted).
      const { sourceCandidates, needed } = await readCandidates(
        tx,
        userId,
        before.length,
      );
      return { requeued: true as const, sourceCandidates, needed };
    });

    if (!phase1.requeued) {
      res.json({ ...phase1.snapshot, requeued: false });
      return;
    }

    // Phase 2: AI calls outside any DB transaction.
    const aiResults = await generateAIQuestions(
      phase1.sourceCandidates,
      phase1.needed,
    );

    // Phase 3: Short transaction — re-acquire lock, re-normalize, write results.
    const snapshot = await db.transaction(async (tx) => {
      await lockQuestionQueue(tx, userId);
      const queued = await normalizeQuestionQueue(tx, userId);
      await writeGeneratedQuestions(tx, userId, aiResults, queued);
      return queueSnapshot(tx, userId);
    });

    res.json({ ...snapshot, requeued: true });
  },
);

router.post("/thoughts/:id/activate", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const thoughtId = req.params.id;

  // Phase 1: Short transaction — lock, normalize, validate, activate the thought,
  // remove it from the queue, compact, and read source candidates.
  type ActivatePhase1 =
    | { kind: "not_found" }
    | { kind: "not_queued" }
    | { kind: "retry"; body: Record<string, unknown> }
    | {
        kind: "activated";
        activatedThought: ThoughtRow;
        sourceCandidates: SourceCandidate[];
        needed: number;
      };

  const phase1: ActivatePhase1 = await db.transaction(async (tx) => {
    await lockQuestionQueue(tx, userId);
    const normalizedQueue = await normalizeQuestionQueue(tx, userId);

    const [thought] = await tx
      .select()
      .from(thoughtsTable)
      .where(
        and(
          eq(thoughtsTable.id, thoughtId),
          eq(thoughtsTable.authorId, userId),
          isNull(thoughtsTable.deletedAt),
        ),
      )
      .limit(1);

    if (!thought) return { kind: "not_found" as const };

    const [queued] = await tx
      .select({ id: thoughtQuestionQueueTable.id })
      .from(thoughtQuestionQueueTable)
      .where(
        and(
          eq(thoughtQuestionQueueTable.userId, userId),
          eq(thoughtQuestionQueueTable.thoughtId, thoughtId),
        ),
      )
      .limit(1);

    if (
      !queued &&
      thought.status === "NORMAL" &&
      thought.createdFrom === "question"
    ) {
      return {
        kind: "retry" as const,
        body: {
          activatedThought: thought,
          ...(await queueSnapshot(tx, userId)),
        },
      };
    }
    if (!queued || thought.status !== "PRELIMINARY") {
      return { kind: "not_queued" as const };
    }

    const [activatedThought] = await tx
      .update(thoughtsTable)
      .set({ status: "NORMAL", updatedAt: new Date() })
      .where(eq(thoughtsTable.id, thought.id))
      .returning();
    await tx
      .delete(thoughtQuestionQueueTable)
      .where(eq(thoughtQuestionQueueTable.id, queued.id));
    await compactQuestionQueue(tx, userId);

    // Queue count after removing the activated thought.
    const postCompactLength = Math.max(0, normalizedQueue.length - 1);
    const { sourceCandidates, needed } = await readCandidates(
      tx,
      userId,
      postCompactLength,
    );
    return { kind: "activated" as const, activatedThought, sourceCandidates, needed };
  });

  if (phase1.kind === "not_found") {
    res.status(404).json({ error: "Thought not found" });
    return;
  }
  if (phase1.kind === "not_queued") {
    res.status(409).json({ error: "Thought is not an active queued question" });
    return;
  }
  if (phase1.kind === "retry") {
    res.status(200).json(phase1.body);
    return;
  }

  // Phase 2: AI calls outside any DB transaction.
  const aiResults = await generateAIQuestions(
    phase1.sourceCandidates,
    phase1.needed,
  );

  // Phase 3: Short transaction — re-acquire lock, re-normalize, write results.
  const snapshot = await db.transaction(async (tx) => {
    await lockQuestionQueue(tx, userId);
    const queued = await normalizeQuestionQueue(tx, userId);
    await writeGeneratedQuestions(tx, userId, aiResults, queued);
    return queueSnapshot(tx, userId);
  });

  res.status(200).json({ activatedThought: phase1.activatedThought, ...snapshot });
});

router.get("/thoughts", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const sourceArticleId =
    typeof req.query.sourceArticleId === "string"
      ? req.query.sourceArticleId
      : undefined;

  const conditions = [
    eq(thoughtsTable.authorId, userId),
    isNull(thoughtsTable.deletedAt),
    // Preliminary question-queue entries are not activated thoughts yet; they
    // must only be reachable through the question-queue endpoints, never leak
    // into the general archive list regardless of client state.
    ne(thoughtsTable.status, "PRELIMINARY"),
    // After promotion, the article is the sole record shown in the archive.
    // Keeping the source thought out of this list prevents one write from
    // appearing once as a thought and again as an editing article.
    notExists(
      db
        .select({ id: thoughtPromotionsTable.id })
        .from(thoughtPromotionsTable)
        .where(eq(thoughtPromotionsTable.fromThoughtId, thoughtsTable.id)),
    ),
    ...(sourceArticleId
      ? [eq(thoughtsTable.sourceArticleId, sourceArticleId)]
      : []),
  ];

  const thoughts = await db
    .select({
      id: thoughtsTable.id,
      authorId: thoughtsTable.authorId,
      content: thoughtsTable.content,
      createdFrom: thoughtsTable.createdFrom,
      sourceArticleId: thoughtsTable.sourceArticleId,
      sourceStoredSentenceId: thoughtsTable.sourceStoredSentenceId,
      status: thoughtsTable.status,
      migratedFromArticleId: thoughtsTable.migratedFromArticleId,
      createdAt: thoughtsTable.createdAt,
      updatedAt: thoughtsTable.updatedAt,
    })
    .from(thoughtsTable)
    .where(and(...conditions))
    .orderBy(desc(thoughtsTable.createdAt));

  res.json(thoughts);
});

router.post("/thoughts", requireAuth, async (req, res) => {
  const parsed = CreateThoughtBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const {
    clientId,
    requestGeneration = 1,
    content,
    createdFrom,
    sourceArticleId,
    sourceStoredSentenceId,
    status,
  } = parsed.data;
  const authorId = req.user!.id;
  if (!isMeaningfulThoughtMarkdown(content)) {
    res
      .status(400)
      .json({ error: "Thought content must include text or an image" });
    return;
  }

  const insertValues = {
    ...(clientId ? { id: clientId } : {}),
    authorId,
    content,
    createdFrom,
    sourceArticleId: sourceArticleId ?? null,
    sourceStoredSentenceId: sourceStoredSentenceId ?? null,
    status: (status ?? "NORMAL") as ThoughtStatus,
    createRequestGeneration: requestGeneration,
  };

  let thought;
  if (clientId) {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`thought-create:${clientId}`}))`,
      );
      const [inserted] = await tx
        .insert(thoughtsTable)
        .values(insertValues)
        .onConflictDoNothing({ target: thoughtsTable.id })
        .returning();
      if (inserted) return { status: 201, thought: inserted } as const;

      const [existing] = await tx
        .select()
        .from(thoughtsTable)
        .where(eq(thoughtsTable.id, clientId))
        .for("update");
      if (!existing || existing.authorId !== authorId) {
        return {
          status: 409,
          error: "Thought id is already in use",
        } as const;
      }

      const [activePromotion] = await tx
        .select({ id: thoughtPromotionsTable.id })
        .from(thoughtPromotionsTable)
        .where(eq(thoughtPromotionsTable.fromThoughtId, clientId))
        .limit(1);
      if (
        activePromotion ||
        existing.deletedAt ||
        existing.migratedFromArticleId
      ) {
        return {
          status: 409,
          error: "Thought can no longer accept a create retry",
        } as const;
      }

      if (
        existing.createdFrom !== createdFrom ||
        existing.sourceArticleId !== (sourceArticleId ?? null) ||
        existing.sourceStoredSentenceId !==
          (sourceStoredSentenceId ?? null) ||
        existing.status !== (status ?? "NORMAL")
      ) {
        return {
          status: 409,
          error: "Thought create retry does not match the original request",
        } as const;
      }

      const retryAction = getThoughtCreateRetryAction({
        existingGeneration: existing.createRequestGeneration,
        incomingGeneration: requestGeneration,
        contentMatches: existing.content === content,
      });
      if (retryAction === "return-existing") {
        return { status: 201, thought: existing } as const;
      }
      if (retryAction === "conflict") {
        return {
          status: 409,
          error: "Thought create retry generation conflicts with existing content",
        } as const;
      }

      const [updated] = await tx
        .update(thoughtsTable)
        .set({
          content,
          createRequestGeneration: requestGeneration,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(thoughtsTable.id, clientId),
            eq(thoughtsTable.authorId, authorId),
            isNull(thoughtsTable.deletedAt),
            sql`${thoughtsTable.createRequestGeneration} < ${requestGeneration}`,
          ),
        )
        .returning();
      if (!updated) {
        return {
          status: 409,
          error: "Thought changed before the create retry completed",
        } as const;
      }
      return { status: 201, thought: updated } as const;
    });

    if ("error" in result) {
      res.status(result.status).json({ error: result.error });
      return;
    }
    thought = result.thought;
  } else {
    [thought] = await db.insert(thoughtsTable).values(insertValues).returning();
  }

  if (!thought) {
    res.status(500).json({ error: "Failed to create thought" });
    return;
  }

  res.status(201).json(thought);

  if (content) {
    const denseTask = process.env.OPENROUTER_API_KEY
      ? generateDenseEmbedding(content)
          .then((vector) =>
            db
              .update(thoughtsTable)
              .set({ textEmbeddingDense: vector })
              .where(eq(thoughtsTable.id, thought.id)),
          )
          .catch((err) => {
            console.error(
              "[embeddings/dense] Failed for thought",
              thought.id,
              err,
            );
          })
      : Promise.resolve(
          console.warn(
            "[embeddings/dense] OPENROUTER_API_KEY not set — skipping for thought",
            thought.id,
          ),
        );

    const sparseTask = (async () => {
      try {
        const sparse = generateSparseEmbedding(content);
        await db
          .update(thoughtsTable)
          .set({ textEmbeddingSparse: sparse })
          .where(eq(thoughtsTable.id, thought.id));
      } catch (err) {
        console.error(
          "[embeddings/sparse] Failed for thought",
          thought.id,
          err,
        );
      }
    })();

    Promise.allSettled([denseTask, sparseTask]);
  }
});

router.get("/thoughts/:id", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const [thought] = await db
    .select({
      id: thoughtsTable.id,
      authorId: thoughtsTable.authorId,
      content: thoughtsTable.content,
      createdFrom: thoughtsTable.createdFrom,
      sourceArticleId: thoughtsTable.sourceArticleId,
      sourceStoredSentenceId: thoughtsTable.sourceStoredSentenceId,
      status: thoughtsTable.status,
      migratedFromArticleId: thoughtsTable.migratedFromArticleId,
      createdAt: thoughtsTable.createdAt,
      updatedAt: thoughtsTable.updatedAt,
    })
    .from(thoughtsTable)
    .where(and(eq(thoughtsTable.id, id), isNull(thoughtsTable.deletedAt)));

  if (!thought) {
    res.status(404).json({ error: "Thought not found" });
    return;
  }
  if (thought.authorId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  res.json(thought);
});

router.patch("/thoughts/:id", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const parsed = UpdateThoughtBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { content } = parsed.data;
  if (!isMeaningfulThoughtMarkdown(content)) {
    res
      .status(400)
      .json({ error: "Thought content must include text or an image" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`thought-promotion:${id}`}))`,
    );
    const [existing] = await tx
      .select({
        id: thoughtsTable.id,
        authorId: thoughtsTable.authorId,
        migratedFromArticleId: thoughtsTable.migratedFromArticleId,
      })
      .from(thoughtsTable)
      .where(and(eq(thoughtsTable.id, id), isNull(thoughtsTable.deletedAt)))
      .for("update");

    if (!existing)
      return { status: 404, body: { error: "Thought not found" } } as const;
    if (existing.authorId !== userId) {
      return { status: 403, body: { error: "Forbidden" } } as const;
    }

    const [activePromotion] = await tx
      .select({ id: thoughtPromotionsTable.id })
      .from(thoughtPromotionsTable)
      .where(
        and(
          eq(thoughtPromotionsTable.fromThoughtId, id),
          eq(thoughtPromotionsTable.promotionType, "promote"),
        ),
      )
      .limit(1);
    if (activePromotion) {
      return {
        status: 409,
        body: {
          error: "A promoted thought must be edited through its review article",
        },
      } as const;
    }

    const [updated] = await tx
      .update(thoughtsTable)
      .set({ content, updatedAt: new Date() })
      .where(
        and(
          eq(thoughtsTable.id, id),
          eq(thoughtsTable.authorId, userId),
          isNull(thoughtsTable.deletedAt),
          existing.migratedFromArticleId
            ? eq(
                thoughtsTable.migratedFromArticleId,
                existing.migratedFromArticleId,
              )
            : isNull(thoughtsTable.migratedFromArticleId),
        ),
      )
      .returning({
        id: thoughtsTable.id,
        authorId: thoughtsTable.authorId,
        content: thoughtsTable.content,
        createdFrom: thoughtsTable.createdFrom,
        sourceArticleId: thoughtsTable.sourceArticleId,
        sourceStoredSentenceId: thoughtsTable.sourceStoredSentenceId,
        status: thoughtsTable.status,
        migratedFromArticleId: thoughtsTable.migratedFromArticleId,
        createdAt: thoughtsTable.createdAt,
        updatedAt: thoughtsTable.updatedAt,
      });
    if (!updated) {
      return {
        status: 409,
        body: {
          error: "Thought changed while it was being updated. Please retry.",
        },
      } as const;
    }
    return { status: 200, body: updated } as const;
  });

  if (result.status === 404) {
    res.status(404).json({ error: "Thought not found" });
    return;
  }
  if (result.status === 403) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  res.status(result.status).json(result.body);
});

router.post("/thoughts/:id/promote", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const thoughtId = req.params.id;
  const parsedBody = PromoteThoughtBody.safeParse(req.body ?? {});
  if (!parsedBody.success) {
    res.status(400).json({
      error: parsedBody.error.issues[0]?.message ?? "Validation error",
      code: "INVALID_SNAPSHOT",
    });
    return;
  }
  const snapshotResult = validateTransitionSnapshot(parsedBody.data);
  if (snapshotResult && "error" in snapshotResult) {
    res.status(400).json(snapshotResult);
    return;
  }
  const snapshot = snapshotResult?.snapshot ?? null;

  try {
    const result = await db.transaction(async (tx) => {
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`thought-promotion:${thoughtId}`}))`,
      );
      const [thought] = await tx
        .select()
        .from(thoughtsTable)
        .where(
          and(eq(thoughtsTable.id, thoughtId), isNull(thoughtsTable.deletedAt)),
        )
        .for("update");

      if (!thought)
        return { status: 404, body: { error: "Thought not found" } } as const;
      if (thought.authorId !== userId)
        return { status: 403, body: { error: "Forbidden" } } as const;

      const [existingPromotion] = await tx
        .select({
          articleId: thoughtPromotionsTable.toDraftId,
          promotionType: thoughtPromotionsTable.promotionType,
        })
        .from(thoughtPromotionsTable)
        .where(eq(thoughtPromotionsTable.fromThoughtId, thoughtId))
        .limit(1);
      if (existingPromotion) {
        if (existingPromotion.promotionType !== "promote") {
          return {
            status: 409,
            body: { error: "Thought has already been promoted" },
          } as const;
        }
        const [existingArticle] = await tx
          .select()
          .from(articlesTable)
          .where(
            and(
              eq(articlesTable.id, existingPromotion.articleId),
              eq(articlesTable.authorId, userId),
              isNull(articlesTable.deletedAt),
            ),
          )
          .limit(1);
        if (!existingArticle) {
          return {
            status: 409,
            body: { error: "Thought promotion result is unavailable" },
          } as const;
        }
        return { status: 200, body: existingArticle } as const;
      }

      if (
        thought.status !== "NORMAL" &&
        thought.migratedFromArticleId === null
      ) {
        return {
          status: 409,
          body: {
            error: "Thought is not in a stage that can be promoted",
            code: "INVALID_STAGE",
          },
        } as const;
      }

      if (
        snapshot &&
        snapshot.expectedUpdatedAt.getTime() !== thought.updatedAt.getTime()
      ) {
        return {
          status: 409,
          body: {
            error:
              "Snapshot is older than the current thought; refresh before promoting",
            code: "STALE_SNAPSHOT",
          },
        } as const;
      }

      const thoughtContent = snapshot
        ? formatThoughtMarkdown(snapshot.title, snapshot.content)
        : (thought.content ?? "");
      const parsedMarkdown = parseThoughtMarkdown(thoughtContent);
      if (!parsedMarkdown) {
        return {
          status: 400,
          body: {
            error:
              "Thought must start with a non-empty H1 title and contain a non-empty body",
            code: "INVALID_SNAPSHOT",
          },
        } as const;
      }

      const [article] = await tx
        .insert(articlesTable)
        .values({
          authorId: thought.authorId,
          title: parsedMarkdown.title,
          content: parsedMarkdown.body,
          status: "DIVIDING",
          sourceArticleId: thought.sourceArticleId,
        })
        .returning();

      await tx.insert(thoughtPromotionsTable).values({
        fromThoughtId: thought.id,
        toDraftId: article.id,
        promotionType: "promote",
      });
      const [updatedThought] = await tx
        .update(thoughtsTable)
        .set({
          ...(snapshot ? { content: thoughtContent } : {}),
          status: "NORMAL",
          migratedFromArticleId: null,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(thoughtsTable.id, thought.id),
            eq(thoughtsTable.authorId, userId),
            isNull(thoughtsTable.deletedAt),
            eq(thoughtsTable.status, thought.status),
            thought.migratedFromArticleId
              ? eq(
                  thoughtsTable.migratedFromArticleId,
                  thought.migratedFromArticleId,
                )
              : isNull(thoughtsTable.migratedFromArticleId),
          ),
        )
        .returning({ id: thoughtsTable.id });
      if (!updatedThought) {
        throw new Error("Thought changed during promotion");
      }

      return { status: 201, body: article } as const;
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    if ((error as { cause?: { code?: string } }).cause?.code === "23505") {
      // A promotion can race with another request. Only report "already
      // promoted" after proving the thought now has a promotion row; a
      // different unique constraint must not masquerade as a completed
      // promotion and leave the user unable to retry.
      const [existingPromotion] = await db
        .select({ id: thoughtPromotionsTable.id })
        .from(thoughtPromotionsTable)
        .where(eq(thoughtPromotionsTable.fromThoughtId, thoughtId))
        .limit(1);
      if (existingPromotion) {
        res.status(409).json({ error: "Thought has already been promoted" });
        return;
      }
      req.log.error(
        { err: error, thoughtId },
        "Unique constraint blocked thought promotion",
      );
      res.status(409).json({
        error:
          "Thought promotion conflicted with an active record. Please retry.",
      });
      return;
    }
    req.log.error({ err: error, thoughtId }, "Error promoting thought");
    res.status(500).json({ error: "Failed to promote thought" });
  }
});

router.delete("/thoughts/:id", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const result = await db.transaction(async (tx) => {
    await lockQuestionQueue(tx, userId);
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${`thought-promotion:${id}`}))`,
    );
    const [existing] = await tx
      .select({
        id: thoughtsTable.id,
        authorId: thoughtsTable.authorId,
        migratedFromArticleId: thoughtsTable.migratedFromArticleId,
      })
      .from(thoughtsTable)
      .where(and(eq(thoughtsTable.id, id), isNull(thoughtsTable.deletedAt)))
      .for("update");

    if (!existing) return "not-found" as const;
    if (existing.authorId !== userId) return "forbidden" as const;

    const [activePromotion] = await tx
      .select({ id: thoughtPromotionsTable.id })
      .from(thoughtPromotionsTable)
      .where(
        and(
          eq(thoughtPromotionsTable.fromThoughtId, id),
          eq(thoughtPromotionsTable.promotionType, "promote"),
        ),
      )
      .limit(1);
    if (activePromotion) return "promoted" as const;

    const deletedAt = new Date();
    const [deleted] = await tx
      .update(thoughtsTable)
      .set({ deletedAt })
      .where(
        and(
          eq(thoughtsTable.id, id),
          eq(thoughtsTable.authorId, userId),
          isNull(thoughtsTable.deletedAt),
          existing.migratedFromArticleId
            ? eq(
                thoughtsTable.migratedFromArticleId,
                existing.migratedFromArticleId,
              )
            : isNull(thoughtsTable.migratedFromArticleId),
        ),
      )
      .returning({ id: thoughtsTable.id });
    if (!deleted) return "conflict" as const;
    await tx
      .delete(thoughtQuestionQueueTable)
      .where(
        and(
          eq(thoughtQuestionQueueTable.userId, userId),
          eq(thoughtQuestionQueueTable.thoughtId, id),
        ),
      );
    await compactQuestionQueue(tx, userId);
    return "deleted" as const;
  });

  if (result === "not-found") {
    res.status(404).json({ error: "Thought not found" });
    return;
  }
  if (result === "forbidden") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (result === "conflict") {
    res.status(409).json({
      error: "Thought changed before it could be deleted. Please retry.",
    });
    return;
  }
  if (result === "promoted") {
    res.status(409).json({
      error: "A promoted thought must be deleted through its review article",
    });
    return;
  }
  res.status(204).send();
});

function isNoteObject(v: unknown): v is { id: string; content: string } {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as Record<string, unknown>).id === "string" &&
    typeof (v as Record<string, unknown>).content === "string"
  );
}

router.post("/thoughts/expand", requireAuth, async (req, res) => {
  const body = req.body as Record<string, unknown> | null | undefined;
  const targetNote = body?.targetNote;
  const candidates = body?.candidates;

  if (!isNoteObject(targetNote)) {
    res
      .status(400)
      .json({ error: "targetNote must have id and content fields" });
    return;
  }
  if (
    !Array.isArray(candidates) ||
    candidates.length === 0 ||
    !candidates.every(isNoteObject)
  ) {
    res.status(400).json({
      error: "candidates must be a non-empty array of {id, content} objects",
    });
    return;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    res
      .status(500)
      .json({ error: "OPENROUTER_API_KEY is not configured on the server" });
    return;
  }

  try {
    const results = await analyzeThoughtExpansion(targetNote, candidates);
    res.json({ results });
  } catch (err) {
    req.log?.error({ err }, "thoughts/expand AI error");
    res.status(500).json({ error: "단상 분석 중 오류가 발생했어요" });
  }
});

export default router;
