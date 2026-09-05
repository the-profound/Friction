import { Router, type IRouter } from "express";
import { and, desc, eq, sql } from "drizzle-orm";
import { db, storedSentencesTable, articlesTable, usersTable, thoughtQuestionSourcesTable, thoughtsTable } from "@workspace/db";
import { CreateStoredSentenceBody, ToggleStoredSentenceFavoriteBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

const sentenceSelect = {
  id: storedSentencesTable.id,
  userId: storedSentencesTable.userId,
  articleId: storedSentencesTable.articleId,
  text: storedSentencesTable.text,
  sourceText: storedSentencesTable.sourceText,
  position: storedSentencesTable.position,
  isFavorite: storedSentencesTable.isFavorite,
  favoritedAt: storedSentencesTable.favoritedAt,
  createdAt: storedSentencesTable.createdAt,
  articleTitle: articlesTable.title,
  articleAuthorName: usersTable.nickname,
};

function selectSentences() {
  return db
    .select(sentenceSelect)
    .from(storedSentencesTable)
    .leftJoin(articlesTable, eq(storedSentencesTable.articleId, articlesTable.id))
    .leftJoin(usersTable, eq(articlesTable.authorId, usersTable.id));
}

router.get("/stored-sentences", requireAuth, async (req, res) => {
  const { userId, favorite } = req.query;
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  if (userId !== req.user!.id) {
    res.status(403).json({ error: "Stored sentences belong to another user", code: "STORED_SENTENCE_USER_MISMATCH" });
    return;
  }

  const conditions = [eq(storedSentencesTable.userId, userId)];
  if (favorite === "true") {
    conditions.push(eq(storedSentencesTable.isFavorite, true));
  }

  const sentences = await selectSentences()
    .where(and(...conditions))
    .orderBy(
      desc(storedSentencesTable.isFavorite),
      sql`${storedSentencesTable.favoritedAt} DESC NULLS LAST`,
      desc(storedSentencesTable.createdAt),
    );

  res.json(sentences);
});

router.post("/stored-sentences", requireAuth, async (req, res) => {
  const parsed = CreateStoredSentenceBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { userId, articleId, text, sourceText, position } = parsed.data;
  if (userId !== req.user!.id) {
    res.status(403).json({ error: "Cannot create a stored sentence for another user", code: "STORED_SENTENCE_USER_MISMATCH" });
    return;
  }

  const [inserted] = await db.insert(storedSentencesTable).values({
    userId: req.user!.id,
    articleId: articleId ?? null,
    text,
    sourceText: sourceText?.trim() || null,
    position: position ?? null,
  }).returning({ id: storedSentencesTable.id });

  if (!inserted) {
    res.status(500).json({ error: "Failed to create sentence" });
    return;
  }

  const [sentence] = await selectSentences()
    .where(and(
      eq(storedSentencesTable.id, inserted.id),
      eq(storedSentencesTable.userId, req.user!.id),
    ));

  res.status(201).json(sentence);
});

router.get("/stored-sentences/:id", requireAuth, async (req, res) => {
  const [sentence] = await selectSentences()
    .where(and(
      eq(storedSentencesTable.id, req.params.id),
      eq(storedSentencesTable.userId, req.user!.id),
    ));

  if (!sentence) {
    res.status(404).json({ error: "Sentence not found" });
    return;
  }
  res.json(sentence);
});

router.delete("/stored-sentences/:id", requireAuth, async (req, res) => {
  const sentenceId = req.params.id;
  const [ownedSentence] = await db
    .select({ id: storedSentencesTable.id })
    .from(storedSentencesTable)
    .where(and(
      eq(storedSentencesTable.id, sentenceId),
      eq(storedSentencesTable.userId, req.user!.id),
    ));
  if (!ownedSentence) {
    res.status(404).json({ error: "Sentence not found" });
    return;
  }
  const [thoughtReference, questionReference] = await Promise.all([
    db
      .select({ id: thoughtsTable.id })
      .from(thoughtsTable)
      .where(eq(thoughtsTable.sourceStoredSentenceId, sentenceId))
      .limit(1),
    db
      .select({ id: thoughtQuestionSourcesTable.id })
      .from(thoughtQuestionSourcesTable)
      .where(eq(thoughtQuestionSourcesTable.sourceStoredSentenceId, sentenceId))
      .limit(1),
  ]);

  if (thoughtReference || questionReference) {
    res.status(409).json({
      error: "This sentence is used as thought provenance and cannot be deleted",
    });
    return;
  }

  const [deleted] = await db.delete(storedSentencesTable).where(and(
    eq(storedSentencesTable.id, sentenceId),
    eq(storedSentencesTable.userId, req.user!.id),
  )).returning();
  if (!deleted) {
    res.status(404).json({ error: "Sentence not found" });
    return;
  }
  res.status(204).send();
});

router.patch("/stored-sentences/:id/favorite", requireAuth, async (req, res) => {
  const parsed = ToggleStoredSentenceFavoriteBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const [updated] = await db.update(storedSentencesTable)
    .set({
      isFavorite: parsed.data.isFavorite,
      favoritedAt: parsed.data.isFavorite ? new Date() : null,
    })
    .where(and(
      eq(storedSentencesTable.id, req.params.id),
      eq(storedSentencesTable.userId, req.user!.id),
    ))
    .returning({ id: storedSentencesTable.id });

  if (!updated) {
    res.status(404).json({ error: "Sentence not found" });
    return;
  }

  const [sentence] = await selectSentences()
    .where(and(
      eq(storedSentencesTable.id, updated.id),
      eq(storedSentencesTable.userId, req.user!.id),
    ));

  res.json(sentence);
});

export default router;
