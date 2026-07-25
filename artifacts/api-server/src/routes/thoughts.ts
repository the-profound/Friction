import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, thoughtsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { CreateThoughtBody } from "@workspace/api-zod";
import { generateEmbedding } from "../lib/embeddings";

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
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.warn("[embeddings] OPENROUTER_API_KEY is not set — skipping embedding for thought", thought.id);
    } else {
      generateEmbedding(content)
        .then((vector) =>
          db
            .update(thoughtsTable)
            .set({ textEmbedding: vector })
            .where(eq(thoughtsTable.id, thought.id))
        )
        .catch((err) => {
          console.error("[embeddings] Failed to generate/store embedding for thought", thought.id, err);
        });
    }
  }
});

export default router;
