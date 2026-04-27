import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, sendRecordsTable, articlesTable, inboxTable, usersTable, teamCollectionsTable } from "@workspace/db";
import { SendArticleBody } from "@workspace/api-zod";

function computeDeliverySlot(): Date {
  const now = new Date();
  const kstMs = now.getTime() + (9 * 60 * 60 * 1000);
  const kstDate = new Date(kstMs);
  const kstHour = kstDate.getUTCHours();

  const todayMidnightKST = new Date(Date.UTC(
    kstDate.getUTCFullYear(),
    kstDate.getUTCMonth(),
    kstDate.getUTCDate(),
  ));

  if (kstHour < 6) {
    const slot6KST = new Date(todayMidnightKST.getTime() + 6 * 60 * 60 * 1000);
    return new Date(slot6KST.getTime() - 9 * 60 * 60 * 1000);
  } else if (kstHour < 18) {
    const slot18KST = new Date(todayMidnightKST.getTime() + 18 * 60 * 60 * 1000);
    return new Date(slot18KST.getTime() - 9 * 60 * 60 * 1000);
  } else {
    const tomorrowMidnightKST = new Date(todayMidnightKST.getTime() + 24 * 60 * 60 * 1000);
    const slot6KST = new Date(tomorrowMidnightKST.getTime() + 6 * 60 * 60 * 1000);
    return new Date(slot6KST.getTime() - 9 * 60 * 60 * 1000);
  }
}

const router: IRouter = Router();

router.get("/send-records", async (req, res) => {
  const { senderId } = req.query;
  if (!senderId || typeof senderId !== "string") {
    res.status(400).json({ error: "senderId is required" });
    return;
  }

  const records = await db
    .select({
      id: sendRecordsTable.id,
      senderId: sendRecordsTable.senderId,
      recipientId: sendRecordsTable.recipientId,
      articleId: sendRecordsTable.articleId,
      inboxId: sendRecordsTable.inboxId,
      targetType: sql<string>`${sendRecordsTable.targetType}::text`.as("target_type"),
      collectionId: sendRecordsTable.teamCollectionId,
      deliverySlot: sendRecordsTable.deliverySlot,
      sentAt: sendRecordsTable.sentAt,
      article: articlesTable,
      recipient: usersTable,
      collectionName: teamCollectionsTable.name,
    })
    .from(sendRecordsTable)
    .leftJoin(articlesTable, eq(sendRecordsTable.articleId, articlesTable.id))
    .leftJoin(usersTable, eq(sendRecordsTable.recipientId, usersTable.id))
    .leftJoin(teamCollectionsTable, eq(sendRecordsTable.teamCollectionId, teamCollectionsTable.id))
    .where(eq(sendRecordsTable.senderId, senderId));

  const now = new Date();
  const enriched = records.map((r) => ({
    ...r,
    isDelivered: new Date(r.deliverySlot) <= now,
  }));

  res.json(enriched);
});

router.get("/send-records/:id", async (req, res) => {
  const records = await db
    .select({
      id: sendRecordsTable.id,
      senderId: sendRecordsTable.senderId,
      recipientId: sendRecordsTable.recipientId,
      articleId: sendRecordsTable.articleId,
      inboxId: sendRecordsTable.inboxId,
      targetType: sql<string>`${sendRecordsTable.targetType}::text`.as("target_type"),
      collectionId: sendRecordsTable.teamCollectionId,
      deliverySlot: sendRecordsTable.deliverySlot,
      sentAt: sendRecordsTable.sentAt,
      article: articlesTable,
      recipient: usersTable,
      collectionName: teamCollectionsTable.name,
    })
    .from(sendRecordsTable)
    .leftJoin(articlesTable, eq(sendRecordsTable.articleId, articlesTable.id))
    .leftJoin(usersTable, eq(sendRecordsTable.recipientId, usersTable.id))
    .leftJoin(teamCollectionsTable, eq(sendRecordsTable.teamCollectionId, teamCollectionsTable.id))
    .where(eq(sendRecordsTable.id, req.params.id));

  if (!records[0]) {
    res.status(404).json({ error: "Send record not found" });
    return;
  }
  const now = new Date();
  res.json({ ...records[0], isDelivered: new Date(records[0].deliverySlot) <= now });
});

router.delete("/send-records/:id", async (req, res) => {
  const [deleted] = await db.delete(sendRecordsTable).where(eq(sendRecordsTable.id, req.params.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Send record not found" });
    return;
  }
  res.status(204).send();
});

router.post("/send-records", async (req, res) => {
  const parsed = SendArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { senderId, recipientId, articleId } = parsed.data;

  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.id, articleId));
  if (!article) {
    res.status(400).json({ error: "Article not found" });
    return;
  }
  if (article.status !== "LETTER") {
    res.status(400).json({ error: "Only LETTER articles can be sent" });
    return;
  }

  const deliverySlot = computeDeliverySlot();

  const result = await db.transaction(async (tx) => {
    const [inboxEntry] = await tx.insert(inboxTable).values({
      recipientId,
      articleId,
      senderId,
      visibleAt: deliverySlot,
    }).returning();

    const [sendRecord] = await tx.insert(sendRecordsTable).values({
      senderId,
      recipientId,
      articleId,
      inboxId: inboxEntry.id,
      deliverySlot,
    }).returning();

    const records = await tx
      .select({
        id: sendRecordsTable.id,
        senderId: sendRecordsTable.senderId,
        recipientId: sendRecordsTable.recipientId,
        articleId: sendRecordsTable.articleId,
        inboxId: sendRecordsTable.inboxId,
        deliverySlot: sendRecordsTable.deliverySlot,
        sentAt: sendRecordsTable.sentAt,
        article: articlesTable,
        recipient: usersTable,
      })
      .from(sendRecordsTable)
      .leftJoin(articlesTable, eq(sendRecordsTable.articleId, articlesTable.id))
      .leftJoin(usersTable, eq(sendRecordsTable.recipientId, usersTable.id))
      .where(eq(sendRecordsTable.id, sendRecord.id));

    return records[0];
  });

  const now = new Date();
  res.status(201).json(result ? { ...result, isDelivered: new Date(result.deliverySlot) <= now } : result);
});

export default router;
