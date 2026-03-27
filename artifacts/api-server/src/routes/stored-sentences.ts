import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, storedSentencesTable } from "@workspace/db";
import { CreateStoredSentenceBody, ToggleStoredSentenceFavoriteBody } from "@workspace/api-zod";

const router: IRouter = Router();

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

  const sentences = await db.select().from(storedSentencesTable).where(and(...conditions));
  res.json(sentences);
});

router.post("/stored-sentences", async (req, res) => {
  const parsed = CreateStoredSentenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { userId, articleId, text, position } = parsed.data;

  const [sentence] = await db.insert(storedSentencesTable).values({
    userId,
    articleId,
    text,
    position: position ?? null,
  }).returning();
  res.status(201).json(sentence);
});

router.get("/stored-sentences/:id", async (req, res) => {
  const [sentence] = await db.select().from(storedSentencesTable).where(eq(storedSentencesTable.id, req.params.id));
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

  const [sentence] = await db.update(storedSentencesTable)
    .set({ isFavorite: parsed.data.isFavorite })
    .where(eq(storedSentencesTable.id, req.params.id))
    .returning();

  if (!sentence) {
    res.status(404).json({ error: "Sentence not found" });
    return;
  }
  res.json(sentence);
});

export default router;
