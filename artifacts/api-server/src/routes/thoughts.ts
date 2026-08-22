import { Router, type IRouter } from "express";
import { and, desc, eq, isNotNull, isNull, ne, sql } from "drizzle-orm";
import { db, articlesTable, thoughtPromotionsTable, thoughtsTable, type ThoughtStatus } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { CreateThoughtBody } from "@workspace/api-zod";
import { generateDenseEmbedding, generateSparseEmbedding } from "../lib/embeddings";
import { analyzeThoughtExpansion } from "../services/analyze-thought-expansion";
import { generateThoughtQuestion } from "../services/generate-thought-question";
import { generateWidgetQuestion } from "../services/generate-widget-question";

const router: IRouter = Router();

type ThoughtMarkdown = {
  title: string;
  body: string;
};

/**
 * A writing-stage thought stores its title as the first Markdown H1. Keeping
 * this rule on the server prevents clients from creating an article with a
 * title that cannot be represented by the thought record.
 */
function parseThoughtMarkdown(markdown: string): ThoughtMarkdown | null {
  const firstLineEnd = markdown.indexOf("\n");
  const firstLine = (firstLineEnd < 0 ? markdown : markdown.slice(0, firstLineEnd)).replace(/\r$/, "");
  const match = /^#(?!#)\s+(.+?)\s*$/.exec(firstLine.trim());
  if (!match) return null;

  const title = match[1].trim();
  const body = firstLineEnd < 0 ? "" : markdown.slice(firstLineEnd + 1).replace(/^\s*\n/, "");
  if (!title || !body.trim()) return null;
  return { title, body };
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

router.get("/thoughts/widget", requireAuth, async (req, res) => {
  const userId = req.user!.id;

  const recentThoughts = await db
    .select({ content: thoughtsTable.content })
    .from(thoughtsTable)
    .where(and(eq(thoughtsTable.authorId, userId), isNull(thoughtsTable.deletedAt)))
    .orderBy(desc(thoughtsTable.createdAt))
    .limit(10);

  const contents = recentThoughts
    .map((t) => t.content?.trim())
    .filter((c): c is string => !!c && c.length > 0);

  if (contents.length === 0 || !process.env.OPENROUTER_API_KEY) {
    res.json({ question: null, subtext: null });
    return;
  }

  try {
    const result = await generateWidgetQuestion(contents);
    res.json({ question: result?.question ?? null, subtext: result?.subtext ?? null });
  } catch (err) {
    console.warn("[thoughts/widget] AI widget question generation failed:", err);
    res.json({ question: null, subtext: null });
  }
});

router.get("/thoughts/:id/question", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;

  const [source] = await db
    .select({ id: thoughtsTable.id, content: thoughtsTable.content })
    .from(thoughtsTable)
    .where(and(eq(thoughtsTable.id, id), eq(thoughtsTable.authorId, userId), isNull(thoughtsTable.deletedAt)));

  if (!source) {
    res.status(404).json({ error: "Thought not found" });
    return;
  }

  if (!source.content || !process.env.OPENROUTER_API_KEY) {
    res.json({ question: null });
    return;
  }

  try {
    const question = await generateThoughtQuestion(source.content);
    res.json({ question });
  } catch (err) {
    console.warn("[thoughts/question] AI question generation failed:", err);
    res.json({ question: null });
  }
});

router.get("/thoughts", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const sourceArticleId = typeof req.query.sourceArticleId === "string" ? req.query.sourceArticleId : undefined;

  const conditions = [
    eq(thoughtsTable.authorId, userId),
    isNull(thoughtsTable.deletedAt),
    ...(sourceArticleId ? [eq(thoughtsTable.sourceArticleId, sourceArticleId)] : []),
  ];

  const thoughts = await db
    .select({
      id: thoughtsTable.id,
      authorId: thoughtsTable.authorId,
      content: thoughtsTable.content,
      createdFrom: thoughtsTable.createdFrom,
      sourceArticleId: thoughtsTable.sourceArticleId,
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
  const { content, createdFrom, sourceArticleId, status } = parsed.data;
  const authorId = req.user!.id;

  const [thought] = await db.insert(thoughtsTable).values({
    authorId,
    content,
    createdFrom,
    sourceArticleId: sourceArticleId ?? null,
    status: (status ?? "NORMAL") as ThoughtStatus,
  }).returning();

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

router.patch("/thoughts/:id", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const { id } = req.params;
  const body = req.body as Record<string, unknown> | null | undefined;
  const content = body?.content;
  if (typeof content !== "string" || content.trim() === "") {
    res.status(400).json({ error: "content must be a non-empty string" });
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
    .set({ content: content.trim(), updatedAt: new Date() })
    .where(eq(thoughtsTable.id, id))
    .returning({
      id: thoughtsTable.id,
      authorId: thoughtsTable.authorId,
      content: thoughtsTable.content,
      createdFrom: thoughtsTable.createdFrom,
      sourceArticleId: thoughtsTable.sourceArticleId,
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

      const article = thought.migratedFromArticleId
        ? await tx
          .update(articlesTable)
          .set({
            title: parsedMarkdown.title,
            content: parsedMarkdown.body,
            status: "DIVIDING",
          })
          .where(
            and(
              eq(articlesTable.id, thought.migratedFromArticleId),
              eq(articlesTable.status, "DRAFT"),
              isNull(articlesTable.deletedAt),
            ),
          )
          .returning()
          .then(([updated]) => updated)
        : await tx
          .insert(articlesTable)
          .values({
            id: thought.id,
            authorId: thought.authorId,
            title: parsedMarkdown.title,
            content: parsedMarkdown.body,
            status: "DIVIDING",
            sourceArticleId: thought.sourceArticleId,
          })
          .returning()
          .then(([created]) => created);

      if (!article) {
        return {
          status: 409,
          body: { error: "The migrated article can no longer be promoted" },
        } as const;
      }

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
      res.status(409).json({ error: "Thought has already been promoted" });
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

  await db.transaction(async (tx) => {
    const deletedAt = new Date();
    await tx
      .update(thoughtsTable)
      .set({ deletedAt })
      .where(eq(thoughtsTable.id, id));
    if (existing.migratedFromArticleId) {
      await tx
        .update(articlesTable)
        .set({ deletedAt })
        .where(
          and(
            eq(articlesTable.id, existing.migratedFromArticleId),
            eq(articlesTable.status, "DRAFT"),
            isNull(articlesTable.deletedAt),
          ),
        );
    }
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
