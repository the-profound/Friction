import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, readingRecordsTable, userArticleReadsTable } from "@workspace/db";
import { UpsertReadingRecordBody, CreateUserArticleReadBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/reading-records", async (req, res) => {
  const { userId, articleId } = req.query;
  if (!userId || !articleId || typeof userId !== "string" || typeof articleId !== "string") {
    res.status(400).json({ error: "userId and articleId are required" });
    return;
  }

  const [record] = await db.select().from(readingRecordsTable)
    .where(and(
      eq(readingRecordsTable.userId, userId),
      eq(readingRecordsTable.articleId, articleId),
    ));

  res.json({ record: record ?? null });
});

router.put("/reading-records", async (req, res) => {
  const parsed = UpsertReadingRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { userId, articleId, currentPage, scrollPosition } = parsed.data;

  const [record] = await db.insert(readingRecordsTable).values({
    userId,
    articleId,
    currentPage,
    scrollPosition,
  }).onConflictDoUpdate({
    target: [readingRecordsTable.userId, readingRecordsTable.articleId],
    set: {
      currentPage,
      scrollPosition,
      updatedAt: new Date(),
    },
  }).returning();

  res.json(record);
});

router.delete("/reading-records/:id", async (req, res) => {
  const [deleted] = await db.delete(readingRecordsTable).where(eq(readingRecordsTable.id, req.params.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Reading record not found" });
    return;
  }
  res.status(204).send();
});

router.post("/user-article-reads", async (req, res) => {
  const parsed = CreateUserArticleReadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { userId, articleId } = parsed.data;

  const [read] = await db.insert(userArticleReadsTable).values({
    userId,
    articleId,
    completedAt: new Date(),
  }).onConflictDoUpdate({
    target: [userArticleReadsTable.userId, userArticleReadsTable.articleId],
    set: { completedAt: new Date() },
  }).returning();

  res.status(201).json(read);
});

router.get("/user-article-reads", async (req, res) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const records = await db.select().from(userArticleReadsTable)
    .where(eq(userArticleReadsTable.userId, userId));

  res.json(records);
});

router.get("/user-article-reads/check", async (req, res) => {
  const { userId, articleId } = req.query;
  if (!userId || !articleId || typeof userId !== "string" || typeof articleId !== "string") {
    res.status(400).json({ error: "userId and articleId are required" });
    return;
  }

  const [record] = await db.select().from(userArticleReadsTable)
    .where(and(
      eq(userArticleReadsTable.userId, userId),
      eq(userArticleReadsTable.articleId, articleId),
    ));

  res.json({
    isRead: !!record,
    completedAt: record?.completedAt ?? null,
  });
});

router.get("/user-article-reads/:id", async (req, res) => {
  const [record] = await db.select().from(userArticleReadsTable).where(eq(userArticleReadsTable.id, req.params.id));
  if (!record) {
    res.status(404).json({ error: "Read record not found" });
    return;
  }
  res.json(record);
});

router.delete("/user-article-reads/:id", async (req, res) => {
  const [deleted] = await db.delete(userArticleReadsTable).where(eq(userArticleReadsTable.id, req.params.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Read record not found" });
    return;
  }
  res.status(204).send();
});

export default router;
