import { Router, type IRouter } from "express";
import { and, eq, lte, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { db, inboxTable, articlesTable, usersTable, userArticleReadsTable } from "@workspace/db";

const router: IRouter = Router();

const sourceArticle = alias(articlesTable, "source_article");

const collectionNameSubquery = sql<string | null>`(
  SELECT COALESCE(
    (
      SELECT tc.name
      FROM team_collection_articles tca
      JOIN team_collections tc ON tca.team_collection_id = tc.id
      WHERE tca.article_id = ${inboxTable.articleId}
      ORDER BY tca.added_at ASC
      LIMIT 1
    ),
    (
      SELECT mc.name
      FROM my_collection_articles mca
      JOIN my_collections mc ON mca.my_collection_id = mc.id
      WHERE mca.article_id = ${inboxTable.articleId}
      ORDER BY mca.added_at ASC
      LIMIT 1
    )
  )
)`;

router.get("/inbox", async (req, res) => {
  const { recipientId } = req.query;
  if (!recipientId || typeof recipientId !== "string") {
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
      collectionName: collectionNameSubquery,
      isReplyToMe: sql<boolean>`(${sourceArticle.id} IS NOT NULL AND ${sourceArticle.authorId} = ${inboxTable.recipientId})`,
      replyToArticleId: articlesTable.sourceArticleId,
      hasReadBefore: sql<boolean>`(${userArticleReadsTable.completedAt} IS NOT NULL)`,
    })
    .from(inboxTable)
    .leftJoin(articlesTable, eq(inboxTable.articleId, articlesTable.id))
    .leftJoin(usersTable, eq(inboxTable.senderId, usersTable.id))
    .leftJoin(sourceArticle, eq(articlesTable.sourceArticleId, sourceArticle.id))
    .leftJoin(
      userArticleReadsTable,
      and(
        eq(userArticleReadsTable.articleId, inboxTable.articleId),
        eq(userArticleReadsTable.userId, inboxTable.recipientId),
      ),
    )
    .where(and(
      eq(inboxTable.recipientId, recipientId),
      lte(inboxTable.visibleAt, new Date()),
      ne(inboxTable.senderId, inboxTable.recipientId),
      eq(inboxTable.isRead, false),
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
      collectionName: collectionNameSubquery,
      isReplyToMe: sql<boolean>`(${sourceArticle.id} IS NOT NULL AND ${sourceArticle.authorId} = ${inboxTable.recipientId})`,
      replyToArticleId: articlesTable.sourceArticleId,
    })
    .from(inboxTable)
    .leftJoin(articlesTable, eq(inboxTable.articleId, articlesTable.id))
    .leftJoin(usersTable, eq(inboxTable.senderId, usersTable.id))
    .leftJoin(sourceArticle, eq(articlesTable.sourceArticleId, sourceArticle.id))
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

  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(inboxTable).set({ isRead: true }).where(eq(inboxTable.id, req.params.id)).returning();

    await tx.insert(userArticleReadsTable).values({
      userId: item.recipientId,
      articleId: item.articleId,
      completedAt: new Date(),
    }).onConflictDoUpdate({
      target: [userArticleReadsTable.userId, userArticleReadsTable.articleId],
      set: { completedAt: new Date() },
    });

    return u;
  });

  res.json(updated);
});

export default router;
