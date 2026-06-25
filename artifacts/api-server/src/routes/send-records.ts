import { Router, type IRouter } from "express";
import { eq, sql } from "drizzle-orm";
import { db, sendRecordsTable, articlesTable, inboxTable, usersTable, teamCollectionsTable } from "@workspace/db";
import { SendArticleBody } from "@workspace/api-zod";
import { computeDeliverySlot } from "../lib/deliverySlot";

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
  const { senderId, recipientId, articleId, isEnvelope } = parsed.data;

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

  let result;
  try {
    result = await db.transaction(async (tx) => {
      const [inboxEntry] = await tx.insert(inboxTable).values({
        recipientId,
        articleId,
        senderId,
        visibleAt: deliverySlot,
        isEnvelope: isEnvelope ?? false,
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
  } catch (err: unknown) {
    const pgErr = err as { code?: string };
    if (pgErr?.code === "23505") {
      res.status(409).json({ error: "This article has already been sent to the recipient." });
      return;
    }
    throw err;
  }

  const now = new Date();
  res.status(201).json(result ? { ...result, isDelivered: new Date(result.deliverySlot) <= now } : result);
});

export default router;
