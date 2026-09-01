import { Router, type IRouter } from "express";
import { and, asc, desc, eq, isNotNull, isNull, ne, notExists, sql } from "drizzle-orm";
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
import { CreateThoughtBody, UpdateThoughtBody, isMeaningfulThoughtMarkdown } from "@workspace/api-zod";
import { generateDenseEmbedding, generateSparseEmbedding } from "../lib/embeddings";
import { analyzeThoughtExpansion } from "../services/analyze-thought-expansion";
import { generatePreliminaryThoughtQuestion } from "../services/generate-preliminary-thought-question";
import { generateRandomPreliminaryThoughtQuestion } from "../services/generate-random-preliminary-thought-question";
import {
  formatPreliminaryQuestionMarkdown,
  isQuestionThoughtMarkdown,
} from "../services/preliminary-question-format";

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

async function lockQuestionQueue(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], userId: string) {
  // Queue mutations for one user must serialize. This prevents concurrent
  // display/refresh retries from creating two "next" questions.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${`thought-question-queue:${userId}`}))`);
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
    .innerJoin(thoughtsTable, eq(thoughtQuestionQueueTable.thoughtId, thoughtsTable.id))
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

async function fillQuestionQueue(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  userId: string,
) {
  let queued = await normalizeQuestionQueue(tx, userId);
  const needed = QUESTION_QUEUE_TARGET_SIZE - queued.length;
  if (needed <= 0) return queued;

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
              eq(thoughtQuestionSourcesTable.questionThoughtId, questionSourceThought.id),
            )
            .where(
              and(
                eq(thoughtQuestionSourcesTable.sourceThoughtId, thoughtsTable.id),
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

  const sourceGroups = Array.from(
    { length: needed },
    (_, index) => sourceCandidates.slice(index * 3, index * 3 + 3),
  ).filter((sources) => sources.length > 0);

  for (const selectedSources of sourceGroups) {
    let generated;
    try {
      generated = await generatePreliminaryThoughtQuestion(selectedSources);
    } catch {
      // AI availability and low-signal input are intentionally non-fatal:
      // callers receive the existing queue rather than a failing record.
      break;
    }
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

    const provenance = [
      ...selectedSources.map((source) => ({
        questionThoughtId: question.id,
        sourceThoughtId: source.id,
      })),
      ...Array.from(new Set(selectedSources.map((source) => source.sourceArticleId).filter(Boolean))).map(
        (sourceArticleId) => ({
          questionThoughtId: question.id,
          sourceArticleId: sourceArticleId!,
        }),
      ),
      ...Array.from(new Set(selectedSources.map((source) => source.sourceStoredSentenceId).filter(Boolean))).map(
        (sourceStoredSentenceId) => ({
          questionThoughtId: question.id,
          sourceStoredSentenceId: sourceStoredSentenceId!,
        }),
      ),
    ];
    if (provenance.length > 0) await tx.insert(thoughtQuestionSourcesTable).values(provenance);

    const lastPosition = queued.at(-1)?.position ?? -1;
    const [queueRow] = await tx
      .insert(thoughtQuestionQueueTable)
      .values({ userId, thoughtId: question.id, position: lastPosition + 1 })
      .returning({ id: thoughtQuestionQueueTable.id, position: thoughtQuestionQueueTable.position });
    queued = [...queued, { queueId: queueRow.id, position: queueRow.position, thought: question }];
  }

  // A user should still have a useful minimum backlog when there are not
  // enough normal thoughts to use as source material. These generic prompts
  // are intentionally only a floor; source-based generation can fill the
  // queue up to the target size when material is available.
  const existingQuestionTitles = new Set(
    queued
      .map((entry) => getQuestionTitle(entry.thought.content))
      .filter((title): title is string => Boolean(title)),
  );
  while (queued.length < QUESTION_QUEUE_MIN_SIZE) {
    const generated = generateRandomPreliminaryThoughtQuestion(existingQuestionTitles);
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

    const lastPosition = queued.at(-1)?.position ?? -1;
    const [queueRow] = await tx
      .insert(thoughtQuestionQueueTable)
      .values({ userId, thoughtId: question.id, position: lastPosition + 1 })
      .returning({ id: thoughtQuestionQueueTable.id, position: thoughtQuestionQueueTable.position });
    queued = [...queued, { queueId: queueRow.id, position: queueRow.position, thought: question }];
    existingQuestionTitles.add(generated.title);
  }

  return queued;
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
  titleLines[titleLines.length - 1] = titleLines[titleLines.length - 1].replace(/[ \t]{2,}$/, "");

  const title = titleLines
    .map((line) => line
      .replace(/!\[([^\]]*)]\([^)]*\)/g, "$1")
      .replace(/\[([^\]]+)]\([^)]*\)/g, "$1")
      .replace(/<\/?u>/gi, "")
      .replace(/[*_~`]+/g, "")
      .trim())
    .join("\n")
    .trim();
  const body = lines.slice(cursor).join("\n").replace(/^\n/, "");
  if (!title || !body.trim()) return null;
  return { title, body };
}

function getQuestionTitle(markdown: string | null): string | null {
  const title = markdown?.split(/\r?\n/, 1)[0]?.trim().replace(/^#\s+Q\.\s*/i, "");
  return title || null;
}

router.get("/thoughts/:id/similar", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const limit = Math.max(1, Math.min(parseInt(String(req.query.limit ?? "15"), 10) || 15, 100));

  const [source] = await db
    .select({
      id: thoughtsTable.id,
      content: thoughtsTable.content,
      textEmbeddingDense: thoughtsTable.textEmbeddingDense,
    })
    .from(thoughtsTable)
    .where(and(eq(thoughtsTable.id, id), eq(thoughtsTable.authorId, userId), isNull(thoughtsTable.deletedAt)));

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
      )
    )
    .orderBy(sql`text_embedding_dense <=> ${vectorLiteral}::vector`)
    .limit(limit);

  if (similar.length === 0) {
    res.json([]);
    return;
  }

  const nullAnalysis = { r: null, k: null, h: null };
  let analysisMap: Record<string, { r: string | null; k: string[] | null; h: string[] | null }> = {};

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
      req.log?.warn({ err }, "[thoughts/similar] AI analysis failed — returning null r/k/h");
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

  const snapshot = await db.transaction(async (tx) => {
    await lockQuestionQueue(tx, userId);
    await fillQuestionQueue(tx, userId);
    return queueSnapshot(tx, userId);
  });
  res.json(snapshot);
});

router.post("/thoughts/question-queue/refresh", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const currentThoughtId = (req.body as Record<string, unknown> | undefined)?.currentThoughtId;
  if (typeof currentThoughtId !== "string") {
    res.status(400).json({ error: "currentThoughtId must be a UUID string" });
    return;
  }

  const result = await db.transaction(async (tx) => {
    await lockQuestionQueue(tx, userId);
    const before = await normalizeQuestionQueue(tx, userId);
    const current = before[0];
    if (!current || current.thought.id !== currentThoughtId) {
      return { ...(await queueSnapshot(tx, userId)), requeued: false };
    }

    await cleanupQuestionQueue(tx, userId);
    const lastPosition = before.at(-1)?.position ?? current.position;
    await tx
      .update(thoughtQuestionQueueTable)
      .set({ position: lastPosition + 1 })
      .where(eq(thoughtQuestionQueueTable.id, current.queueId));
    await compactQuestionQueue(tx, userId);
    await fillQuestionQueue(tx, userId);
    return { ...(await queueSnapshot(tx, userId)), requeued: true };
  });

  res.json(result);
});

router.post("/thoughts/:id/activate", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const thoughtId = req.params.id;

  const result = await db.transaction(async (tx) => {
    await lockQuestionQueue(tx, userId);
    await normalizeQuestionQueue(tx, userId);
    const [thought] = await tx
      .select()
      .from(thoughtsTable)
      .where(and(eq(thoughtsTable.id, thoughtId), eq(thoughtsTable.authorId, userId), isNull(thoughtsTable.deletedAt)))
      .limit(1);

    if (!thought) return { status: 404, body: { error: "Thought not found" } } as const;

    const [queued] = await tx
      .select({ id: thoughtQuestionQueueTable.id })
      .from(thoughtQuestionQueueTable)
      .where(and(eq(thoughtQuestionQueueTable.userId, userId), eq(thoughtQuestionQueueTable.thoughtId, thoughtId)))
      .limit(1);

    // A network retry after a successful activation sees the same normal
    // thought and returns the queue snapshot without a second refill.
    if (!queued && thought.status === "NORMAL" && thought.createdFrom === "question") {
      return {
        status: 200,
        body: { activatedThought: thought, ...(await queueSnapshot(tx, userId)) },
      } as const;
    }
    if (!queued || thought.status !== "PRELIMINARY") {
      return { status: 409, body: { error: "Thought is not an active queued question" } } as const;
    }

    const [activatedThought] = await tx
      .update(thoughtsTable)
      .set({ status: "NORMAL", updatedAt: new Date() })
      .where(eq(thoughtsTable.id, thought.id))
      .returning();
    await tx.delete(thoughtQuestionQueueTable).where(eq(thoughtQuestionQueueTable.id, queued.id));
    await compactQuestionQueue(tx, userId);
    await fillQuestionQueue(tx, userId);

    return {
      status: 200,
      body: { activatedThought, ...(await queueSnapshot(tx, userId)) },
    } as const;
  });

  res.status(result.status).json(result.body);
});

router.get("/thoughts", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const sourceArticleId = typeof req.query.sourceArticleId === "string" ? req.query.sourceArticleId : undefined;

  const conditions = [
    eq(thoughtsTable.authorId, userId),
    isNull(thoughtsTable.deletedAt),
    // After promotion, the article is the sole record shown in the archive.
    // Keeping the source thought out of this list prevents one write from
    // appearing once as a thought and again as an editing article.
    notExists(
      db
        .select({ id: thoughtPromotionsTable.id })
        .from(thoughtPromotionsTable)
        .where(eq(thoughtPromotionsTable.fromThoughtId, thoughtsTable.id)),
    ),
    ...(sourceArticleId ? [eq(thoughtsTable.sourceArticleId, sourceArticleId)] : []),
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
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { clientId, content, createdFrom, sourceArticleId, sourceStoredSentenceId, status } = parsed.data;
  const authorId = req.user!.id;
  if (!isMeaningfulThoughtMarkdown(content)) {
    res.status(400).json({ error: "Thought content must include text or an image" });
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
  };

  let [thought] = clientId
    ? await db
        .insert(thoughtsTable)
        .values(insertValues)
        .onConflictDoNothing({ target: thoughtsTable.id })
        .returning()
    : await db.insert(thoughtsTable).values(insertValues).returning();

  if (!thought && clientId) {
    const [ownedExisting] = await db
      .select({ id: thoughtsTable.id })
      .from(thoughtsTable)
      .where(and(eq(thoughtsTable.id, clientId), eq(thoughtsTable.authorId, authorId)))
      .limit(1);
    if (!ownedExisting) {
      res.status(409).json({ error: "Thought id is already in use" });
      return;
    }

    [thought] = await db
      .update(thoughtsTable)
      .set({ content, updatedAt: new Date() })
      .where(and(eq(thoughtsTable.id, clientId), eq(thoughtsTable.authorId, authorId)))
      .returning();
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
              .where(eq(thoughtsTable.id, thought.id))
          )
          .catch((err) => {
            console.error("[embeddings/dense] Failed for thought", thought.id, err);
          })
      : Promise.resolve(
          console.warn("[embeddings/dense] OPENROUTER_API_KEY not set — skipping for thought", thought.id)
        );

    const sparseTask = (async () => {
      try {
        const sparse = generateSparseEmbedding(content);
        await db
          .update(thoughtsTable)
          .set({ textEmbeddingSparse: sparse })
          .where(eq(thoughtsTable.id, thought.id));
      } catch (err) {
        console.error("[embeddings/sparse] Failed for thought", thought.id, err);
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
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { content } = parsed.data;
  if (!isMeaningfulThoughtMarkdown(content)) {
    res.status(400).json({ error: "Thought content must include text or an image" });
    return;
  }

  const [existing] = await db
    .select({
      id: thoughtsTable.id,
      authorId: thoughtsTable.authorId,
      migratedFromArticleId: thoughtsTable.migratedFromArticleId,
    })
    .from(thoughtsTable)
    .where(and(eq(thoughtsTable.id, id), isNull(thoughtsTable.deletedAt)));

  if (!existing) {
    res.status(404).json({ error: "Thought not found" });
    return;
  }
  if (existing.authorId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  const [updated] = await db
    .update(thoughtsTable)
    .set({ content, updatedAt: new Date() })
    .where(eq(thoughtsTable.id, id))
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

  res.json(updated);
});

router.post("/thoughts/:id/promote", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const thoughtId = req.params.id;

  try {
    const result = await db.transaction(async (tx) => {
      const [thought] = await tx
        .select()
        .from(thoughtsTable)
        .where(and(eq(thoughtsTable.id, thoughtId), isNull(thoughtsTable.deletedAt)));

      if (!thought) return { status: 404, body: { error: "Thought not found" } } as const;
      if (thought.authorId !== userId) return { status: 403, body: { error: "Forbidden" } } as const;

      const parsedMarkdown = parseThoughtMarkdown(thought.content ?? "");
      if (!parsedMarkdown) {
        return {
          status: 400,
          body: { error: "Thought must start with a non-empty H1 title and contain a non-empty body" },
        } as const;
      }

      const [existingPromotion] = await tx
        .select({ id: thoughtPromotionsTable.id, articleId: thoughtPromotionsTable.toDraftId })
        .from(thoughtPromotionsTable)
        .where(eq(thoughtPromotionsTable.fromThoughtId, thoughtId))
        .limit(1);
      if (existingPromotion) {
        return { status: 409, body: { error: "Thought has already been promoted" } } as const;
      }

      // Always create a fresh DIVIDING article. Legacy DRAFT rows are
      // soft-deactivated by migration 0033 and are never reused.
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
      await tx
        .update(thoughtsTable)
        .set({ status: "NORMAL", updatedAt: new Date() })
        .where(eq(thoughtsTable.id, thought.id));

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
      req.log.error({ err: error, thoughtId }, "Unique constraint blocked thought promotion");
      res.status(409).json({ error: "Thought promotion conflicted with an active record. Please retry." });
      return;
    }
    req.log.error({ err: error, thoughtId }, "Error promoting thought");
    res.status(500).json({ error: "Failed to promote thought" });
  }
});

router.delete("/thoughts/:id", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const [existing] = await db
    .select({
      id: thoughtsTable.id,
      authorId: thoughtsTable.authorId,
    })
    .from(thoughtsTable)
    .where(and(eq(thoughtsTable.id, id), isNull(thoughtsTable.deletedAt)));

  if (!existing) {
    res.status(404).json({ error: "Thought not found" });
    return;
  }
  if (existing.authorId !== userId) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db.transaction(async (tx) => {
    const deletedAt = new Date();
    await tx
      .update(thoughtsTable)
      .set({ deletedAt })
      .where(eq(thoughtsTable.id, id));
    await tx
      .delete(thoughtQuestionQueueTable)
      .where(and(eq(thoughtQuestionQueueTable.userId, userId), eq(thoughtQuestionQueueTable.thoughtId, id)));
  });

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
    res.status(400).json({ error: "targetNote must have id and content fields" });
    return;
  }
  if (!Array.isArray(candidates) || candidates.length === 0 || !candidates.every(isNoteObject)) {
    res.status(400).json({ error: "candidates must be a non-empty array of {id, content} objects" });
    return;
  }

  if (!process.env.OPENROUTER_API_KEY) {
    res.status(500).json({ error: "OPENROUTER_API_KEY is not configured on the server" });
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
