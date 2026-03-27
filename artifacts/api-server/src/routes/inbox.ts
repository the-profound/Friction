import { Router, type IRouter } from "express";
import { and, eq, lte } from "drizzle-orm";
import { db, inboxTable, articlesTable, usersTable, userArticleReadsTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/inbox", async (req, res) => {
  const { recipientId } = req.query;
  if (!recipientId) {
    res.status(400).json({ error: "recipientId is required" });
    return;
  }

  const items = await db
    .select({
      id: inboxTable.id,
      recipientId: inboxTable.recipientId,
      articleId: inboxTable.articleId,
      senderId: inboxTable.senderId,
      visibleAt: inboxTable.visibleAt,
      openedAt: inboxTable.openedAt,
      isRead: inboxTable.isRead,
      createdAt: inboxTable.createdAt,
      article: articlesTable,
      sender: usersTable,
    })
    .from(inboxTable)
    .leftJoin(articlesTable, eq(inboxTable.articleId, articlesTable.id))
    .leftJoin(usersTable, eq(inboxTable.senderId, usersTable.id))
    .where(and(
      eq(inboxTable.recipientId, recipientId as string),
      lte(inboxTable.visibleAt, new Date()),
    ))
    .orderBy(inboxTable.visibleAt);

  res.json(items);
});

router.get("/inbox/:id", async (req, res) => {
  const items = await db
    .select({
      id: inboxTable.id,
      recipientId: inboxTable.recipientId,
      articleId: inboxTable.articleId,
      senderId: inboxTable.senderId,
      visibleAt: inboxTable.visibleAt,
      openedAt: inboxTable.openedAt,
      isRead: inboxTable.isRead,
      createdAt: inboxTable.createdAt,
      article: articlesTable,
      sender: usersTable,
    })
    .from(inboxTable)
    .leftJoin(articlesTable, eq(inboxTable.articleId, articlesTable.id))
    .leftJoin(usersTable, eq(inboxTable.senderId, usersTable.id))
    .where(eq(inboxTable.id, req.params.id));

  if (!items[0]) {
    res.status(404).json({ error: "Inbox item not found" });
    return;
  }
  res.json(items[0]);
});

router.delete("/inbox/:id", async (req, res) => {
  const [deleted] = await db.delete(inboxTable).where(eq(inboxTable.id, req.params.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Inbox item not found" });
    return;
  }
  res.status(204).send();
});

router.post("/inbox/:id/open", async (req, res) => {
  const [item] = await db.select().from(inboxTable).where(eq(inboxTable.id, req.params.id));
  if (!item) {
    res.status(404).json({ error: "Inbox item not found" });
    return;
  }
  if (!item.openedAt) {
    const [updated] = await db.update(inboxTable).set({ openedAt: new Date() }).where(eq(inboxTable.id, req.params.id)).returning();
    res.json(updated);
  } else {
    res.json(item);
  }
});

router.post("/inbox/:id/read", async (req, res) => {
  const [item] = await db.select().from(inboxTable).where(eq(inboxTable.id, req.params.id));
  if (!item) {
    res.status(404).json({ error: "Inbox item not found" });
    return;
  }

  const [updated] = await db.update(inboxTable).set({ isRead: true }).where(eq(inboxTable.id, req.params.id)).returning();

  await db.insert(userArticleReadsTable).values({
    userId: item.recipientId,
    articleId: item.articleId,
    completedAt: new Date(),
  }).onConflictDoUpdate({
    target: [userArticleReadsTable.userId, userArticleReadsTable.articleId],
    set: { completedAt: new Date() },
  });

  res.json(updated);
});

export default router;
