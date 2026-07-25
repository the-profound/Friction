import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, thoughtsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { CreateThoughtBody } from "@workspace/api-zod";
import { generateDenseEmbedding, generateSparseEmbedding } from "../lib/embeddings";

const router: IRouter = Router();

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
  const { content, createdFrom, sourceArticleId } = parsed.data;
  const authorId = req.user!.id;

  const [thought] = await db.insert(thoughtsTable).values({
    authorId,
    content,
    createdFrom,
    sourceArticleId: sourceArticleId ?? null,
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

    const sparseTask = generateSparseEmbedding(content)
      .then((sparse) =>
        db
          .update(thoughtsTable)
          .set({ textEmbeddingSparse: sparse })
          .where(eq(thoughtsTable.id, thought.id))
      )
      .catch((err) => {
        console.error("[embeddings/sparse] Failed for thought", thought.id, err);
      });

    Promise.allSettled([denseTask, sparseTask]);
  }
});

export default router;
