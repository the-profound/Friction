import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, storedSentencesTable, articlesTable } from "@workspace/db";
import { CreateStoredSentenceBody, ToggleStoredSentenceFavoriteBody } from "@workspace/api-zod";

const router: IRouter = Router();

const sentenceSelect = {
  id: storedSentencesTable.id,
  userId: storedSentencesTable.userId,
  articleId: storedSentencesTable.articleId,
  text: storedSentencesTable.text,
  position: storedSentencesTable.position,
  isFavorite: storedSentencesTable.isFavorite,
  createdAt: storedSentencesTable.createdAt,
  articleTitle: articlesTable.title,
};

router.get("/stored-sentences", async (req, res) => {
  const { userId, favorite } = req.query;
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const conditions = [eq(storedSentencesTable.userId, userId)];
  if (favorite === "true") {
    conditions.push(eq(storedSentencesTable.isFavorite, true));
  }

  const sentences = await db
    .select(sentenceSelect)
    .from(storedSentencesTable)
    .leftJoin(articlesTable, eq(storedSentencesTable.articleId, articlesTable.id))
    .where(and(...conditions));

  res.json(sentences);
});

router.post("/stored-sentences", async (req, res) => {
  const parsed = CreateStoredSentenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { userId, articleId, text, position } = parsed.data;

  const [inserted] = await db.insert(storedSentencesTable).values({
    userId,
    articleId,
    text,
    position: position ?? null,
  }).returning({ id: storedSentencesTable.id });

  if (!inserted) {
    res.status(500).json({ error: "Failed to create sentence" });
    return;
  }

  const [sentence] = await db
    .select(sentenceSelect)
    .from(storedSentencesTable)
    .leftJoin(articlesTable, eq(storedSentencesTable.articleId, articlesTable.id))
    .where(eq(storedSentencesTable.id, inserted.id));

  res.status(201).json(sentence);
});

router.get("/stored-sentences/:id", async (req, res) => {
  const [sentence] = await db
    .select(sentenceSelect)
    .from(storedSentencesTable)
    .leftJoin(articlesTable, eq(storedSentencesTable.articleId, articlesTable.id))
    .where(eq(storedSentencesTable.id, req.params.id));

  if (!sentence) {
    res.status(404).json({ error: "Sentence not found" });
    return;
  }
  res.json(sentence);
});

router.delete("/stored-sentences/:id", async (req, res) => {
  const [deleted] = await db.delete(storedSentencesTable).where(eq(storedSentencesTable.id, req.params.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Sentence not found" });
    return;
  }
  res.status(204).send();
});

router.patch("/stored-sentences/:id/favorite", async (req, res) => {
  const parsed = ToggleStoredSentenceFavoriteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const [updated] = await db.update(storedSentencesTable)
    .set({ isFavorite: parsed.data.isFavorite })
    .where(eq(storedSentencesTable.id, req.params.id))
    .returning({ id: storedSentencesTable.id });

  if (!updated) {
    res.status(404).json({ error: "Sentence not found" });
    return;
  }

  const [sentence] = await db
    .select(sentenceSelect)
    .from(storedSentencesTable)
    .leftJoin(articlesTable, eq(storedSentencesTable.articleId, articlesTable.id))
    .where(eq(storedSentencesTable.id, updated.id));

  res.json(sentence);
});

export default router;
