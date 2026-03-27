import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, sendRecordsTable, articlesTable, inboxTable, usersTable } from "@workspace/db";

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
  if (!senderId) {
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
      deliverySlot: sendRecordsTable.deliverySlot,
      sentAt: sendRecordsTable.sentAt,
      article: articlesTable,
      recipient: usersTable,
    })
    .from(sendRecordsTable)
    .leftJoin(articlesTable, eq(sendRecordsTable.articleId, articlesTable.id))
    .leftJoin(usersTable, eq(sendRecordsTable.recipientId, usersTable.id))
    .where(eq(sendRecordsTable.senderId, senderId as string));

  res.json(records);
});

router.post("/send-records", async (req, res) => {
  const { senderId, recipientId, articleId } = req.body;
  if (!senderId || !recipientId || !articleId) {
    res.status(400).json({ error: "senderId, recipientId, and articleId are required" });
    return;
  }

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

  const [inboxEntry] = await db.insert(inboxTable).values({
    recipientId,
    articleId,
    senderId,
    visibleAt: deliverySlot,
  }).returning();

  const [sendRecord] = await db.insert(sendRecordsTable).values({
    senderId,
    recipientId,
    articleId,
    inboxId: inboxEntry.id,
    deliverySlot,
  }).returning();

  const records = await db
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

  res.status(201).json(records[0]);
});

export default router;
