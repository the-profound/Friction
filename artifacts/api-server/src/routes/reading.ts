import { Router, type IRouter, type Response } from "express";
import { and, eq, lt } from "drizzle-orm";
import { db, readingRecordsTable, userArticleReadsTable } from "@workspace/db";
import { UpsertReadingRecordBody, CreateUserArticleReadBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

export function resolveReadingSaveRevision(
  saveRevision: number | undefined,
  now: number = Date.now(),
): number {
  return saveRevision ?? now;
}

function rejectDifferentUser(
  requestedUserId: string,
  authenticatedUserId: string,
  res: Response,
): boolean {
  if (requestedUserId === authenticatedUserId) return false;
  res.status(403).json({
    error: "Reading data belongs to another user",
    code: "READING_USER_MISMATCH",
  });
  return true;
}

router.get("/reading-records", requireAuth, async (req, res) => {
  const { userId, articleId } = req.query;
  if (!userId || !articleId || typeof userId !== "string" || typeof articleId !== "string") {
    res.status(400).json({ error: "userId and articleId are required" });
    return;
  }
  if (rejectDifferentUser(userId, req.user!.id, res)) return;

  const [record] = await db.select().from(readingRecordsTable)
    .where(and(
      eq(readingRecordsTable.userId, userId),
      eq(readingRecordsTable.articleId, articleId),
    ));

  res.json({ record: record ?? null });
});

router.put("/reading-records", requireAuth, async (req, res) => {
  const parsed = UpsertReadingRecordBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { userId, articleId, currentPage, scrollPosition } = parsed.data;
  const saveRevision = resolveReadingSaveRevision(parsed.data.saveRevision);
  if (rejectDifferentUser(userId, req.user!.id, res)) return;

  const [record] = await db.insert(readingRecordsTable).values({
    userId,
    articleId,
    currentPage,
    scrollPosition,
    saveRevision,
  }).onConflictDoUpdate({
    target: [readingRecordsTable.userId, readingRecordsTable.articleId],
    set: {
      currentPage,
      scrollPosition,
      saveRevision,
      updatedAt: new Date(),
    },
    setWhere: lt(readingRecordsTable.saveRevision, saveRevision),
  }).returning();

  if (record) {
    res.json(record);
    return;
  }
  const [currentRecord] = await db.select().from(readingRecordsTable)
    .where(and(
      eq(readingRecordsTable.userId, userId),
      eq(readingRecordsTable.articleId, articleId),
    ));
  res.json(currentRecord);
});

router.delete("/reading-records/:id", requireAuth, async (req, res) => {
  const recordId = String(req.params.id);
  const [deleted] = await db.delete(readingRecordsTable)
    .where(and(
      eq(readingRecordsTable.id, recordId),
      eq(readingRecordsTable.userId, req.user!.id),
    ))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Reading record not found" });
    return;
  }
  res.status(204).send();
});

router.post("/user-article-reads", requireAuth, async (req, res) => {
  const parsed = CreateUserArticleReadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { userId, articleId } = parsed.data;
  if (rejectDifferentUser(userId, req.user!.id, res)) return;

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

router.get("/user-article-reads", requireAuth, async (req, res) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  if (rejectDifferentUser(userId, req.user!.id, res)) return;

  const records = await db.select().from(userArticleReadsTable)
    .where(eq(userArticleReadsTable.userId, userId));

  res.json(records);
});

router.get("/user-article-reads/check", requireAuth, async (req, res) => {
  const { userId, articleId } = req.query;
  if (!userId || !articleId || typeof userId !== "string" || typeof articleId !== "string") {
    res.status(400).json({ error: "userId and articleId are required" });
    return;
  }
  if (rejectDifferentUser(userId, req.user!.id, res)) return;

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

router.get("/user-article-reads/:id", requireAuth, async (req, res) => {
  const recordId = String(req.params.id);
  const [record] = await db.select().from(userArticleReadsTable).where(and(
    eq(userArticleReadsTable.id, recordId),
    eq(userArticleReadsTable.userId, req.user!.id),
  ));
  if (!record) {
    res.status(404).json({ error: "Read record not found" });
    return;
  }
  res.json(record);
});

router.delete("/user-article-reads/:id", requireAuth, async (req, res) => {
  const recordId = String(req.params.id);
  const [deleted] = await db.delete(userArticleReadsTable)
    .where(and(
      eq(userArticleReadsTable.id, recordId),
      eq(userArticleReadsTable.userId, req.user!.id),
    ))
    .returning();
  if (!deleted) {
    res.status(404).json({ error: "Read record not found" });
    return;
  }
  res.status(204).send();
});

export default router;
