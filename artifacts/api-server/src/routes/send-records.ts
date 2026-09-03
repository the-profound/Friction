import { Router, type IRouter, type Response } from "express";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import {
  db,
  sendRecordsTable,
  articlesTable,
  inboxTable,
  usersTable,
  spacesTable,
  spaceLettersTable,
  spaceParticipationsTable,
  spaceScheduledSendsTable,
  teamCollectionsTable,
} from "@workspace/db";
import { SendArticleBody } from "@workspace/api-zod";
import { kstDateAt6, kstDateString, computeDeliverySlot } from "../lib/deliverySlot";
import { resolveReplyTarget } from "../lib/sendReplyTarget";
import { resolveCallerId } from "../middlewares/requireAuth";

const router: IRouter = Router();

function withDeliveryStatus<T extends { deliverySlot: Date | string }>(record: T | undefined) {
  if (!record) return record;
  return {
    ...record,
    deliveryDate: kstDateString(new Date(record.deliverySlot)),
    isDelivered: new Date(record.deliverySlot) <= new Date(),
  };
}

function parseRequestedDeliverySlot(deliveryDate: string | undefined): Date | null {
  if (deliveryDate === undefined) return computeDeliverySlot();
  const requested = kstDateAt6(deliveryDate);
  if (!requested) return null;
  const earliestDate = kstDateString(computeDeliverySlot());
  return deliveryDate >= earliestDate ? requested : null;
}

function sendValidationError(res: Response, message: string) {
  res.status(400).json({ error: message });
}

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
      replyToInboxId: sendRecordsTable.replyToInboxId,
      replyToArticleId: sql<string | null>`(
        SELECT i.article_id FROM inbox i WHERE i.id = ${sendRecordsTable.replyToInboxId}
      )`.as("reply_to_article_id"),
      targetType: sql<string>`${sendRecordsTable.targetType}::text`.as("target_type"),
      spaceId: sendRecordsTable.spaceId,
      spaceScheduledSendId: sendRecordsTable.spaceScheduledSendId,
      collectionId: sendRecordsTable.teamCollectionId,
      deliverySlot: sendRecordsTable.deliverySlot,
      sentAt: sendRecordsTable.sentAt,
      article: articlesTable,
      recipient: usersTable,
      collectionName: teamCollectionsTable.name,
      spaceName: spacesTable.name,
    })
    .from(sendRecordsTable)
    .leftJoin(articlesTable, eq(sendRecordsTable.articleId, articlesTable.id))
    .leftJoin(usersTable, eq(sendRecordsTable.recipientId, usersTable.id))
    .leftJoin(teamCollectionsTable, eq(sendRecordsTable.teamCollectionId, teamCollectionsTable.id))
    .leftJoin(spacesTable, eq(sendRecordsTable.spaceId, spacesTable.id))
    .where(eq(sendRecordsTable.senderId, senderId));

  const now = new Date();
  const enriched = records.map((r) => ({
    ...r,
    deliveryDate: kstDateString(new Date(r.deliverySlot)),
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
      replyToInboxId: sendRecordsTable.replyToInboxId,
      replyToArticleId: sql<string | null>`(
        SELECT i.article_id FROM inbox i WHERE i.id = ${sendRecordsTable.replyToInboxId}
      )`.as("reply_to_article_id"),
      targetType: sql<string>`${sendRecordsTable.targetType}::text`.as("target_type"),
      spaceId: sendRecordsTable.spaceId,
      spaceScheduledSendId: sendRecordsTable.spaceScheduledSendId,
      collectionId: sendRecordsTable.teamCollectionId,
      deliverySlot: sendRecordsTable.deliverySlot,
      sentAt: sendRecordsTable.sentAt,
      article: articlesTable,
      recipient: usersTable,
      collectionName: teamCollectionsTable.name,
      spaceName: spacesTable.name,
    })
    .from(sendRecordsTable)
    .leftJoin(articlesTable, eq(sendRecordsTable.articleId, articlesTable.id))
    .leftJoin(usersTable, eq(sendRecordsTable.recipientId, usersTable.id))
    .leftJoin(teamCollectionsTable, eq(sendRecordsTable.teamCollectionId, teamCollectionsTable.id))
    .leftJoin(spacesTable, eq(sendRecordsTable.spaceId, spacesTable.id))
    .where(eq(sendRecordsTable.id, req.params.id));

  if (!records[0]) {
    res.status(404).json({ error: "Send record not found" });
    return;
  }
  const now = new Date();
  res.json({
    ...records[0],
    deliveryDate: kstDateString(new Date(records[0].deliverySlot)),
    isDelivered: new Date(records[0].deliverySlot) <= now,
  });
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
  // Orval's Zod output represents OpenAPI date fields as Date values, while
  // JSON clients correctly send the calendar date as "YYYY-MM-DD". Convert
  // only for schema validation and retain the original calendar-date string
  // for the KST policy below.
  const rawBody = (req.body && typeof req.body === "object"
    ? req.body
    : {}) as Record<string, unknown>;
  const rawDeliveryDate = rawBody.deliveryDate;
  const validationDeliveryDate =
    typeof rawDeliveryDate === "string"
      ? (kstDateAt6(rawDeliveryDate) ?? new Date(Number.NaN))
      : rawDeliveryDate;
  const parsed = SendArticleBody.safeParse({
    ...rawBody,
    deliveryDate: validationDeliveryDate,
  });
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const {
    senderId,
    recipientId,
    articleId,
    isEnvelope,
    targetType = "person",
    replyToInboxId,
    replyToArticleId,
    spaceId,
  } = parsed.data;
  const deliveryDate =
    typeof rawDeliveryDate === "string"
      ? rawDeliveryDate
      : parsed.data.deliveryDate
        ? kstDateString(parsed.data.deliveryDate)
        : undefined;

  if (targetType === "person" && !recipientId) {
    sendValidationError(res, "recipientId is required for person sends");
    return;
  }
  if (targetType === "reply" && !replyToInboxId && !replyToArticleId) {
    sendValidationError(res, "replyToInboxId or replyToArticleId is required for reply sends");
    return;
  }
  if (targetType === "space" && !spaceId) {
    sendValidationError(res, "spaceId is required for space sends");
    return;
  }
  if (targetType !== "reply" && (replyToInboxId || replyToArticleId)) {
    sendValidationError(res, "Reply source fields are only valid for reply sends");
    return;
  }
  if (targetType !== "space" && spaceId) {
    sendValidationError(res, "spaceId is only valid for space sends");
    return;
  }
  const deliverySlot = parseRequestedDeliverySlot(deliveryDate);
  if (!deliverySlot) {
    res.status(400).json({ error: "선택한 수신일은 현재 시각 기준 가장 빠른 수신일보다 과거일 수 없습니다." });
    return;
  }

  // New target types are tied to the authenticated caller. Person sends keep
  // the legacy senderId-only contract so existing clients remain compatible.
  const callerId = targetType === "person" ? null : await resolveCallerId(req);
  if (!callerId) {
    res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    return;
  }
  if (callerId !== senderId) {
    res.status(403).json({ error: "senderId must match the authenticated user" });
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
  if (targetType !== "person" && article.authorId !== senderId) {
    res.status(403).json({ error: "Only the article author can use this send target" });
    return;
  }

  let result;
  try {
    result = await db.transaction(async (tx) => {
      let inboxId: string | undefined;
      let resolvedRecipientId = recipientId;
      let resolvedReplyToInboxId: string | undefined;
      let resolvedSpaceScheduledSendId: string | undefined;

      if (targetType === "reply") {
        const [sourceInbox] = await tx
          .select()
          .from(inboxTable)
          .where(and(
            eq(inboxTable.recipientId, senderId),
            eq(inboxTable.isRead, true),
            ...(replyToInboxId
              ? [eq(inboxTable.id, replyToInboxId)]
              : [eq(inboxTable.articleId, replyToArticleId!)]),
          ))
          .orderBy(desc(inboxTable.createdAt))
          .limit(1);
        const replyTarget = resolveReplyTarget(senderId, sourceInbox);
        resolvedRecipientId = replyTarget.recipientId;
        resolvedReplyToInboxId = replyTarget.replyToInboxId;
      } else if (targetType === "space") {
        const [space] = await tx
          .select({ id: spacesTable.id, status: spacesTable.status })
          .from(spacesTable)
          .where(eq(spacesTable.id, spaceId!))
          .limit(1);
        if (!space) {
          throw Object.assign(new Error("Space not found"), { statusCode: 404 });
        }
        if (space.status !== "ACTIVE") {
          throw Object.assign(new Error("진행 중인 공간에만 보낼 수 있습니다."), { statusCode: 400 });
        }
        const [participation] = await tx
          .select({ id: spaceParticipationsTable.id })
          .from(spaceParticipationsTable)
          .where(and(
            eq(spaceParticipationsTable.spaceId, spaceId!),
            eq(spaceParticipationsTable.userId, senderId),
            eq(spaceParticipationsTable.status, "APPROVED"),
          ))
          .limit(1);
        if (!participation) {
          throw Object.assign(new Error("승인된 공간 참여자만 보낼 수 있습니다."), { statusCode: 403 });
        }
        // Serialize retries of the same article into the same space before
        // checking for an existing reservation.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(
          hashtextextended(${`${spaceId}:${articleId}:${senderId}`}, 0)
        )`);
        const [existingSend] = await tx
          .select({ id: spaceScheduledSendsTable.id })
          .from(spaceScheduledSendsTable)
          .innerJoin(spaceLettersTable, eq(spaceScheduledSendsTable.spaceLetterId, spaceLettersTable.id))
          .where(and(
            eq(spaceScheduledSendsTable.spaceId, spaceId!),
            eq(spaceLettersTable.sourceArticleId, articleId),
            eq(spaceLettersTable.authorId, senderId),
            ne(spaceScheduledSendsTable.status, "CANCELLED"),
          ))
          .limit(1);
        if (existingSend) {
          throw Object.assign(new Error("이 편지는 해당 공간에 이미 예약되어 있습니다."), { statusCode: 409 });
        }

        const [spaceLetter] = await tx.insert(spaceLettersTable).values({
          spaceId: spaceId!,
          authorId: senderId,
          sourceArticleId: articleId,
          letterType: "REPLY",
          visibility: "PUBLIC",
        }).returning({ id: spaceLettersTable.id });
        const [scheduledSend] = await tx.insert(spaceScheduledSendsTable).values({
          spaceId: spaceId!,
          spaceLetterId: spaceLetter.id,
          scheduledAt: deliverySlot,
        }).returning({ id: spaceScheduledSendsTable.id });
        resolvedSpaceScheduledSendId = scheduledSend.id;
        resolvedRecipientId = undefined;
      }

      if (targetType !== "space") {
        const [inboxEntry] = await tx.insert(inboxTable).values({
          recipientId: resolvedRecipientId!,
          articleId,
          senderId,
          visibleAt: deliverySlot,
          isEnvelope: isEnvelope ?? false,
        }).returning({ id: inboxTable.id });
        inboxId = inboxEntry.id;
      }

      const [sendRecord] = await tx.insert(sendRecordsTable).values({
        senderId,
        recipientId: resolvedRecipientId,
        articleId,
        inboxId,
        replyToInboxId: resolvedReplyToInboxId,
        spaceId: targetType === "space" ? spaceId : undefined,
        spaceScheduledSendId: resolvedSpaceScheduledSendId,
        targetType,
        deliverySlot,
      }).returning();

      const records = await tx
        .select({
          id: sendRecordsTable.id,
          senderId: sendRecordsTable.senderId,
          recipientId: sendRecordsTable.recipientId,
          articleId: sendRecordsTable.articleId,
          inboxId: sendRecordsTable.inboxId,
          replyToInboxId: sendRecordsTable.replyToInboxId,
          replyToArticleId: sql<string | null>`(
            SELECT i.article_id FROM inbox i WHERE i.id = ${sendRecordsTable.replyToInboxId}
          )`.as("reply_to_article_id"),
          deliverySlot: sendRecordsTable.deliverySlot,
          sentAt: sendRecordsTable.sentAt,
          targetType: sql<string>`${sendRecordsTable.targetType}::text`.as("target_type"),
          spaceId: sendRecordsTable.spaceId,
          spaceScheduledSendId: sendRecordsTable.spaceScheduledSendId,
          article: articlesTable,
          recipient: usersTable,
          collectionName: teamCollectionsTable.name,
          spaceName: spacesTable.name,
        })
        .from(sendRecordsTable)
        .leftJoin(articlesTable, eq(sendRecordsTable.articleId, articlesTable.id))
        .leftJoin(usersTable, eq(sendRecordsTable.recipientId, usersTable.id))
        .leftJoin(teamCollectionsTable, eq(sendRecordsTable.teamCollectionId, teamCollectionsTable.id))
        .leftJoin(spacesTable, eq(sendRecordsTable.spaceId, spacesTable.id))
        .where(eq(sendRecordsTable.id, sendRecord.id));

      return records[0];
    });
  } catch (err: unknown) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode) {
      res.status(statusCode).json({ error: (err as Error).message });
      return;
    }
    const pgErr = err as { code?: string; cause?: { code?: string } };
    if ((pgErr?.code ?? pgErr?.cause?.code) === "23505") {
      res.status(409).json({ error: "This article has already been sent to the recipient." });
      return;
    }
    throw err;
  }

  res.status(201).json(withDeliveryStatus(result));
});

export default router;
