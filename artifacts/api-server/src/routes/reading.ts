import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, readingRecordsTable, userArticleReadsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/reading-records", async (req, res) => {
  const { userId, articleId } = req.query;
  if (!userId || !articleId) {
    res.status(400).json({ error: "userId and articleId are required" });
    return;
  }

  const [record] = await db.select().from(readingRecordsTable)
    .where(and(
      eq(readingRecordsTable.userId, userId as string),
      eq(readingRecordsTable.articleId, articleId as string),
    ));

  res.json({ record: record ?? null });
});

router.put("/reading-records", async (req, res) => {
  const { userId, articleId, currentPage, scrollPosition } = req.body;
  if (!userId || !articleId || currentPage === undefined || scrollPosition === undefined) {
    res.status(400).json({ error: "userId, articleId, currentPage, and scrollPosition are required" });
    return;
  }

  if (scrollPosition < 0 || scrollPosition > 1) {
    res.status(400).json({ error: "scrollPosition must be between 0 and 1" });
    return;
  }

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

router.post("/user-article-reads", async (req, res) => {
  const { userId, articleId } = req.body;
  if (!userId || !articleId) {
    res.status(400).json({ error: "userId and articleId are required" });
    return;
  }

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

router.get("/user-article-reads/check", async (req, res) => {
  const { userId, articleId } = req.query;
  if (!userId || !articleId) {
    res.status(400).json({ error: "userId and articleId are required" });
    return;
  }

  const [record] = await db.select().from(userArticleReadsTable)
    .where(and(
      eq(userArticleReadsTable.userId, userId as string),
      eq(userArticleReadsTable.articleId, articleId as string),
    ));

  res.json({
    isRead: !!record,
    completedAt: record?.completedAt ?? null,
  });
});

export default router;
