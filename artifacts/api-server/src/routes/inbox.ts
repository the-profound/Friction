import { Router, type IRouter } from "express";
import { and, desc, eq, ilike, inArray, isNull, lte, ne, sql } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import {
  db,
  inboxTable,
  articlesTable,
  usersTable,
  userArticleReadsTable,
} from "@workspace/db";
import { resolveInboxSourceName } from "../lib/inboxSource";

const router: IRouter = Router();

const sourceArticle = alias(articlesTable, "source_article");
const sourceArticleRead = alias(userArticleReadsTable, "source_article_read");
const ANONYMOUS_PARTICIPANT_NAME = "참여자";
// Keep the inbox list aligned with GET /articles/:id: an inbox row must not
// lead users to a draft, deleted, or otherwise non-readable article.
const readableInboxArticle = sql`${articlesTable.status} IN ('DIVIDING', 'CLOSING', 'LETTER')`;

export const scheduledSendSpaceIdSubquery = sql<string | null>`(
  SELECT ss.space_id
  FROM space_scheduled_sends ss
  WHERE ss.id = ${inboxTable.sourceSpaceScheduledSendId}
  LIMIT 1
)`;

// Some pre-provenance rows have neither source column populated. Match those
// only to an exact SENT reservation (article, author, and delivery timestamp),
// mirroring the migration backfill and protecting ordinary person sends.
export const legacyScheduledSpaceIdSubquery = sql<string | null>`(
  SELECT CASE
    WHEN COUNT(DISTINCT ss.space_id) = 1
    THEN (ARRAY_AGG(DISTINCT ss.space_id))[1]
  END
  FROM space_letters sl
  JOIN space_scheduled_sends ss
    ON ss.space_letter_id = sl.id
   AND ss.space_id = sl.space_id
   AND ss.status = 'SENT'
  WHERE ${inboxTable.sourceSpaceId} IS NULL
    AND ${inboxTable.sourceSpaceScheduledSendId} IS NULL
    AND ${inboxTable.sourceTeamCollectionId} IS NULL
    AND sl.source_article_id = ${inboxTable.articleId}
    AND sl.author_id = ${inboxTable.senderId}
    AND ss.scheduled_at = ${inboxTable.visibleAt}
    AND NOT EXISTS (
      SELECT 1
      FROM send_records sr
      WHERE sr.inbox_id = ${inboxTable.id}
    )
)`;

// Space provenance priority is explicit source, durable reservation link, then
// exact historical reservation evidence. Collection guesses never participate.
export const inboxSpaceIdSubquery = sql<string | null>`(
  COALESCE(
    ${inboxTable.sourceSpaceId},
    ${scheduledSendSpaceIdSubquery},
    ${legacyScheduledSpaceIdSubquery}
  )
)`;
const inboxSpaceAnonymousSubquery = sql<boolean | null>`(
  SELECT s.is_anonymous
  FROM spaces s
  WHERE s.id = ${inboxSpaceIdSubquery}
  LIMIT 1
)`;
const inboxSpaceStatusSubquery = sql<string | null>`(
  SELECT s.status::text
  FROM spaces s
  WHERE s.id = ${inboxSpaceIdSubquery}
  LIMIT 1
)`;
const inboxSpaceNicknameSubquery = sql<string | null>`(
  COALESCE(
    (
      SELECT sp.space_nickname
      FROM space_participations sp
      WHERE sp.space_id = ${inboxSpaceIdSubquery}
        AND sp.user_id = ${inboxTable.senderId}
        AND sp.status IN ('PENDING', 'APPROVED')
      ORDER BY sp.updated_at DESC
      LIMIT 1
    ),
    (
      SELECT scr.space_nickname
      FROM space_code_requests scr
      WHERE scr.space_id = ${inboxSpaceIdSubquery}
        AND scr.requester_id = ${inboxTable.senderId}
        AND scr.status IN ('PENDING', 'APPROVED')
      ORDER BY scr.updated_at DESC
      LIMIT 1
    )
  )
)`;
const senderDisplayName = sql<string>`(
  CASE
    WHEN ${inboxSpaceAnonymousSubquery} IS TRUE THEN
      CASE
        WHEN ${inboxSpaceStatusSubquery} = 'RECRUITING' THEN ${ANONYMOUS_PARTICIPANT_NAME}
        ELSE COALESCE(NULLIF(btrim(${inboxSpaceNicknameSubquery}), ''), ${ANONYMOUS_PARTICIPANT_NAME})
      END
    ELSE COALESCE(${usersTable.nickname}, ${ANONYMOUS_PARTICIPANT_NAME})
  END
)`;

type InboxRow = {
  sender?: typeof usersTable.$inferSelect | null;
  isAnonymousSpace: boolean | null;
  explicitSpaceName: string | null;
  scheduledSpaceName: string | null;
  legacyScheduledSpaceName: string | null;
  teamCollectionName: string | null;
  personalCollectionName: string | null;
  [key: string]: unknown;
};

function sanitizeInboxRow<T extends InboxRow>(row: T) {
  const {
    isAnonymousSpace,
    explicitSpaceName,
    scheduledSpaceName,
    legacyScheduledSpaceName,
    teamCollectionName,
    personalCollectionName,
    ...item
  } = row;
  // Anonymous inbox responses must not expose the account nickname/email
  // through the sender object. senderDisplayName is the sole display path.
  return {
    ...item,
    collectionName: resolveInboxSourceName({
      explicitSpaceName,
      scheduledSpaceName,
      legacyScheduledSpaceName,
      teamCollectionName,
      personalCollectionName,
    }),
    ...(isAnonymousSpace ? { sender: undefined } : {}),
  };
}

const explicitSpaceNameSubquery = sql<string | null>`(
  SELECT s.name FROM spaces s WHERE s.id = ${inboxTable.sourceSpaceId}
)`;
const scheduledSpaceNameSubquery = sql<string | null>`(
  SELECT s.name FROM spaces s WHERE s.id = ${scheduledSendSpaceIdSubquery}
)`;
const legacyScheduledSpaceNameSubquery = sql<string | null>`(
  SELECT s.name FROM spaces s WHERE s.id = ${legacyScheduledSpaceIdSubquery}
)`;
const teamCollectionNameSubquery = sql<string | null>`(
  SELECT tc.name
  FROM team_collections tc
  WHERE tc.id = ${inboxTable.sourceTeamCollectionId}
)`;
const personalCollectionNameSubquery = sql<string | null>`(
  SELECT mc.name
  FROM my_collection_articles mca
  JOIN my_collections mc ON mca.my_collection_id = mc.id
  WHERE mca.article_id = ${inboxTable.articleId}
  ORDER BY mca.added_at ASC
  LIMIT 1
)`;

router.get("/inbox", async (req, res) => {
  const { recipientId, titleQuery, isRead } = req.query;
  if (!recipientId || typeof recipientId !== "string") {
    res.status(400).json({ error: "recipientId is required" });
    return;
  }

  const whereConditions = [
    eq(inboxTable.recipientId, recipientId),
    lte(inboxTable.visibleAt, new Date()),
    ne(inboxTable.senderId, inboxTable.recipientId),
    readableInboxArticle,
    isNull(articlesTable.deletedAt),
  ];
  // Optional isRead filter: pass isRead=false to get only unread items (inbox screen),
  // or omit entirely to get all visible items (picker, etc.)
  if (isRead === "false") {
    whereConditions.push(eq(inboxTable.isRead, false));
  } else if (isRead === "true") {
    whereConditions.push(eq(inboxTable.isRead, true));
  }
  if (titleQuery && typeof titleQuery === "string") {
    whereConditions.push(ilike(articlesTable.title, `%${titleQuery}%`));
  }

  const items = await db
    .select({
      id: inboxTable.id,
      recipientId: inboxTable.recipientId,
      articleId: inboxTable.articleId,
      senderId: inboxTable.senderId,
      sourceTeamCollectionId: inboxTable.sourceTeamCollectionId,
      sourceSpaceId: inboxSpaceIdSubquery,
      visibleAt: inboxTable.visibleAt,
      openedAt: inboxTable.openedAt,
      isRead: inboxTable.isRead,
      isEnvelope: inboxTable.isEnvelope,
      createdAt: inboxTable.createdAt,
      article: articlesTable,
      sender: usersTable,
      senderDisplayName,
      isAnonymousSpace: inboxSpaceAnonymousSubquery,
      explicitSpaceName: explicitSpaceNameSubquery,
      scheduledSpaceName: scheduledSpaceNameSubquery,
      legacyScheduledSpaceName: legacyScheduledSpaceNameSubquery,
      teamCollectionName: teamCollectionNameSubquery,
      personalCollectionName: personalCollectionNameSubquery,
      isReplyToMe: sql<boolean>`(${sourceArticle.id} IS NOT NULL AND ${sourceArticle.authorId} = ${inboxTable.recipientId})`,
      replyToArticleId: articlesTable.sourceArticleId,
      hasReadBefore: sql<boolean>`(${userArticleReadsTable.completedAt} IS NOT NULL)`,
      hasReadSourceArticle: sql<boolean | null>`(CASE WHEN ${articlesTable.sourceArticleId} IS NULL THEN NULL ELSE (${sourceArticleRead.completedAt} IS NOT NULL) END)`,
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
    .leftJoin(
      sourceArticleRead,
      and(
        eq(sourceArticleRead.articleId, articlesTable.sourceArticleId),
        eq(sourceArticleRead.userId, inboxTable.recipientId),
      ),
    )
    .where(and(...whereConditions))
    .orderBy(inboxTable.visibleAt);

  res.json(items.map(sanitizeInboxRow));
});

router.get("/inbox/:id", async (req, res) => {
  const items = await db
    .select({
      id: inboxTable.id,
      recipientId: inboxTable.recipientId,
      articleId: inboxTable.articleId,
      senderId: inboxTable.senderId,
      sourceTeamCollectionId: inboxTable.sourceTeamCollectionId,
      sourceSpaceId: inboxSpaceIdSubquery,
      visibleAt: inboxTable.visibleAt,
      openedAt: inboxTable.openedAt,
      isRead: inboxTable.isRead,
      isEnvelope: inboxTable.isEnvelope,
      createdAt: inboxTable.createdAt,
      article: articlesTable,
      sender: usersTable,
      senderDisplayName,
      isAnonymousSpace: inboxSpaceAnonymousSubquery,
      explicitSpaceName: explicitSpaceNameSubquery,
      scheduledSpaceName: scheduledSpaceNameSubquery,
      legacyScheduledSpaceName: legacyScheduledSpaceNameSubquery,
      teamCollectionName: teamCollectionNameSubquery,
      personalCollectionName: personalCollectionNameSubquery,
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
  res.json(sanitizeInboxRow(items[0]));
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

// Bulk-marks every other unread inbox row for the same (recipient, article)
// as read. Used after a user finishes one delivery of an article that arrived
// through multiple team collections so the duplicates clear without being
// archived. Per-item /read endpoint above is unchanged.
router.post("/inbox/article/:articleId/read-others", async (req, res) => {
  const { articleId } = req.params;
  const { recipientId, exceptInboxId } = req.query;

  if (!recipientId || typeof recipientId !== "string") {
    res.status(400).json({ error: "recipientId is required" });
    return;
  }

  const conditions = [
    eq(inboxTable.recipientId, recipientId),
    eq(inboxTable.articleId, articleId),
    eq(inboxTable.isRead, false),
  ];
  if (typeof exceptInboxId === "string" && exceptInboxId.length > 0) {
    conditions.push(ne(inboxTable.id, exceptInboxId));
  }

  const updated = await db
    .update(inboxTable)
    .set({ isRead: true })
    .where(and(...conditions))
    .returning({ id: inboxTable.id });

  res.json({ updatedCount: updated.length });
});

// ── DEV: reseal the 5 most-recent inbox letters as sealed envelopes ──────────
// Matches the same filter as the inbox carousel (isRead=false, visibleAt<=now,
// senderId != recipientId) then takes the 5 newest by visibleAt.
router.post("/inbox/dev/reseal", async (req, res) => {
  const { recipientId } = req.body;
  if (!recipientId || typeof recipientId !== "string") {
    res.status(400).json({ error: "recipientId is required" });
    return;
  }

  const recent = await db
    .select({ id: inboxTable.id })
    .from(inboxTable)
    .where(
      and(
        eq(inboxTable.recipientId, recipientId),
        eq(inboxTable.isRead, false),
        lte(inboxTable.visibleAt, new Date()),
        ne(inboxTable.senderId, inboxTable.recipientId),
      ),
    )
    .orderBy(desc(inboxTable.visibleAt))
    .limit(5);

  if (recent.length === 0) {
    res.json({ count: 0 });
    return;
  }

  const ids = recent.map((r: { id: string }) => r.id);
  await db
    .update(inboxTable)
    .set({ isEnvelope: true, openedAt: null })
    .where(inArray(inboxTable.id, ids));

  res.json({ count: ids.length });
});

export default router;
