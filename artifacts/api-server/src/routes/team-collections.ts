import { Router, type IRouter } from "express";
import { and, eq, count, gt, isNull, isNotNull, sql } from "drizzle-orm";
import {
  db,
  teamCollectionsTable,
  teamCollectionMembershipsTable,
  teamCollectionArticlesTable,
  articlesTable,
  usersTable,
  inboxTable,
  userArticleReadsTable,
} from "@workspace/db";
import {
  CreateTeamCollectionBody,
  UpdateTeamCollectionBody,
  AddTeamMemberBody,
  AddTeamArticleBody,
} from "@workspace/api-zod";

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * Returns the KST date (YYYY-MM-DD) that the next "오늘의 인사" should be assigned to.
 * Before 18:00 KST → today; at/after 18:00 KST → tomorrow.
 * The returned string is shaped to match Postgres `date` columns.
 */
function computeNoticeDateKST(now: Date = new Date()): string {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const kstHour = kst.getUTCHours();
  const base = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  if (kstHour >= 18) base.setUTCDate(base.getUTCDate() + 1);
  return `${base.getUTCFullYear()}-${String(base.getUTCMonth() + 1).padStart(2, "0")}-${String(base.getUTCDate()).padStart(2, "0")}`;
}

/**
 * Returns the next regular delivery slot (the same logic the send-records route uses).
 * Notice posts use the same slot logic, so a notice keyed to today (sent before 18:00 KST)
 * lands at 18:00 KST today, and one keyed to tomorrow (sent after 18:00 KST) lands at
 * 06:00 KST tomorrow — matching the "오늘의 인사" date label shown to the OWNER.
 */
function computeDeliverySlot(now: Date = new Date()): Date {
  const kst = new Date(now.getTime() + KST_OFFSET_MS);
  const kstHour = kst.getUTCHours();
  const todayMidnightKST = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  if (kstHour < 6) {
    return new Date(todayMidnightKST.getTime() + 6 * 60 * 60 * 1000 - KST_OFFSET_MS);
  }
  if (kstHour < 18) {
    return new Date(todayMidnightKST.getTime() + 18 * 60 * 60 * 1000 - KST_OFFSET_MS);
  }
  const tomorrow = new Date(todayMidnightKST.getTime() + 24 * 60 * 60 * 1000);
  return new Date(tomorrow.getTime() + 6 * 60 * 60 * 1000 - KST_OFFSET_MS);
}

const router: IRouter = Router();

const pendingTeamCollectionCreates = new Set<string>();

router.get("/team-collections", async (req, res) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const memberships = await db
    .select({
      id: teamCollectionsTable.id,
      name: teamCollectionsTable.name,
      description: teamCollectionsTable.description,
      creatorId: teamCollectionsTable.creatorId,
      role: teamCollectionMembershipsTable.role,
      createdAt: teamCollectionsTable.createdAt,
      updatedAt: teamCollectionsTable.updatedAt,
    })
    .from(teamCollectionMembershipsTable)
    .innerJoin(teamCollectionsTable, eq(teamCollectionMembershipsTable.teamCollectionId, teamCollectionsTable.id))
    .where(eq(teamCollectionMembershipsTable.userId, userId));

  const results = [];
  for (const m of memberships) {
    const [memberCountResult] = await db
      .select({ value: count() })
      .from(teamCollectionMembershipsTable)
      .where(eq(teamCollectionMembershipsTable.teamCollectionId, m.id));
    results.push({ ...m, memberCount: memberCountResult?.value ?? 0 });
  }

  res.json(results);
});

router.post("/team-collections", async (req, res) => {
  const parsed = CreateTeamCollectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { name, description, creatorId } = parsed.data;
  const normalizedDesc = (description ?? "").trim() || null;

  const lockKey = `${creatorId}:${name}:${normalizedDesc ?? ""}`;
  if (pendingTeamCollectionCreates.has(lockKey)) {
    res.status(409).json({ error: "중복 요청입니다. 잠시 후 다시 시도해주세요." });
    return;
  }

  pendingTeamCollectionCreates.add(lockKey);
  try {
    const dedupeWindow = new Date(Date.now() - 10_000);
    const descCondition = normalizedDesc
      ? eq(teamCollectionsTable.description, normalizedDesc)
      : isNull(teamCollectionsTable.description);

    const [recent] = await db
      .select()
      .from(teamCollectionsTable)
      .where(
        and(
          eq(teamCollectionsTable.creatorId, creatorId),
          eq(teamCollectionsTable.name, name),
          descCondition,
          gt(teamCollectionsTable.createdAt, dedupeWindow),
        ),
      )
      .limit(1);

    if (recent) {
      res.status(201).json(recent);
      return;
    }

    const [collection] = await db.insert(teamCollectionsTable).values({
      name,
      description: normalizedDesc,
      creatorId,
    }).returning();

    await db.insert(teamCollectionMembershipsTable).values({
      teamCollectionId: collection.id,
      userId: creatorId,
      role: "OWNER",
    });

    res.status(201).json(collection);
  } finally {
    pendingTeamCollectionCreates.delete(lockKey);
  }
});

router.get("/team-collections/:id", async (req, res) => {
  const [row] = await db
    .select({
      id: teamCollectionsTable.id,
      name: teamCollectionsTable.name,
      description: teamCollectionsTable.description,
      creatorId: teamCollectionsTable.creatorId,
      createdAt: teamCollectionsTable.createdAt,
      updatedAt: teamCollectionsTable.updatedAt,
      creatorNickname: usersTable.nickname,
    })
    .from(teamCollectionsTable)
    .leftJoin(usersTable, eq(teamCollectionsTable.creatorId, usersTable.id))
    .where(eq(teamCollectionsTable.id, req.params.id));
  if (!row) {
    res.status(404).json({ error: "Team collection not found" });
    return;
  }
  res.json(row);
});

router.patch("/team-collections/:id", async (req, res) => {
  const parsed = UpdateTeamCollectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [collection] = await db.update(teamCollectionsTable).set(updates).where(eq(teamCollectionsTable.id, req.params.id)).returning();
  if (!collection) {
    res.status(404).json({ error: "Team collection not found" });
    return;
  }
  res.json(collection);
});

router.delete("/team-collections/:id", async (req, res) => {
  await db.delete(teamCollectionArticlesTable).where(eq(teamCollectionArticlesTable.teamCollectionId, req.params.id));
  await db.delete(teamCollectionMembershipsTable).where(eq(teamCollectionMembershipsTable.teamCollectionId, req.params.id));
  const [deleted] = await db.delete(teamCollectionsTable).where(eq(teamCollectionsTable.id, req.params.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Team collection not found" });
    return;
  }
  res.status(204).send();
});

router.get("/team-collections/:id/members", async (req, res) => {
  const members = await db
    .select({
      id: teamCollectionMembershipsTable.id,
      teamCollectionId: teamCollectionMembershipsTable.teamCollectionId,
      userId: teamCollectionMembershipsTable.userId,
      role: teamCollectionMembershipsTable.role,
      joinedAt: teamCollectionMembershipsTable.joinedAt,
      user: usersTable,
    })
    .from(teamCollectionMembershipsTable)
    .leftJoin(usersTable, eq(teamCollectionMembershipsTable.userId, usersTable.id))
    .where(eq(teamCollectionMembershipsTable.teamCollectionId, req.params.id));

  res.json(members);
});

router.post("/team-collections/:id/members", async (req, res) => {
  const parsed = AddTeamMemberBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { userId } = parsed.data;

  const existing = await db.select().from(teamCollectionMembershipsTable)
    .where(and(
      eq(teamCollectionMembershipsTable.teamCollectionId, req.params.id),
      eq(teamCollectionMembershipsTable.userId, userId),
    ));

  if (existing.length > 0) {
    res.status(400).json({ error: "User is already a member" });
    return;
  }

  const [membership] = await db.insert(teamCollectionMembershipsTable).values({
    teamCollectionId: req.params.id,
    userId,
    role: "MEMBER",
  }).returning();
  res.status(201).json(membership);
});

router.delete("/team-collections/:teamId/members/:userId", async (req, res) => {
  const [deleted] = await db.delete(teamCollectionMembershipsTable)
    .where(and(
      eq(teamCollectionMembershipsTable.teamCollectionId, req.params.teamId),
      eq(teamCollectionMembershipsTable.userId, req.params.userId),
    ))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Membership not found" });
    return;
  }
  res.status(204).send();
});

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.get("/team-collections/:id/articles", async (req, res) => {
  const now = new Date();
  const teamCollectionId = req.params.id;
  const { userId } = req.query;
  if (userId !== undefined && (typeof userId !== "string" || !UUID_REGEX.test(userId))) {
    res.status(400).json({ error: "userId must be a UUID" });
    return;
  }
  const requesterId = typeof userId === "string" && userId.length > 0 ? userId : null;

  // Fetch all rows for this collection (including soft-deleted).
  // We'll post-filter in JS based on visibility rules.
  // Always join inbox and reads tables; if no requesterId, join conditions will never
  // match (NULL = anything is false) so those columns return NULL.
  const NEVER_MATCH_ID = "00000000-0000-0000-0000-000000000000";
  const effectiveRequesterId = requesterId ?? NEVER_MATCH_ID;

  const rows = await db
    .select({
      id: teamCollectionArticlesTable.id,
      teamCollectionId: teamCollectionArticlesTable.teamCollectionId,
      articleId: teamCollectionArticlesTable.articleId,
      addedBy: teamCollectionArticlesTable.addedBy,
      addedAt: teamCollectionArticlesTable.addedAt,
      deletedAt: teamCollectionArticlesTable.deletedAt,
      article: articlesTable,
      completedAt: userArticleReadsTable.completedAt,
      requesterVisibleAt: inboxTable.visibleAt,
    })
    .from(teamCollectionArticlesTable)
    .leftJoin(articlesTable, eq(teamCollectionArticlesTable.articleId, articlesTable.id))
    .leftJoin(
      inboxTable,
      and(
        eq(inboxTable.articleId, teamCollectionArticlesTable.articleId),
        eq(inboxTable.recipientId, effectiveRequesterId),
      ),
    )
    .leftJoin(
      userArticleReadsTable,
      and(
        eq(userArticleReadsTable.articleId, teamCollectionArticlesTable.articleId),
        eq(userArticleReadsTable.userId, effectiveRequesterId),
      ),
    )
    .where(eq(teamCollectionArticlesTable.teamCollectionId, teamCollectionId));

  // Build sets for O(1) lookups
  // ALL article IDs in this collection (including soft-deleted placeholders)
  const allCollectionArticleIds = new Set(rows.map((r) => r.articleId));

  // Article IDs that have at least one live reply in this collection
  const replyParentIds = new Set<string>();
  for (const r of rows) {
    if (r.deletedAt == null && r.article?.sourceArticleId) {
      replyParentIds.add(r.article.sourceArticleId);
    }
  }

  const visible = rows.filter((r) => {
    if (r.deletedAt != null) {
      // Soft-deleted: only include as placeholder if it still has live replies
      return replyParentIds.has(r.articleId);
    }

    // Live row: strictly gate by inbox visibleAt when requesterId is present.
    // Sender's own articles are included in inbox inserts (same delivery slot),
    // so missing inbox records mean the article has not been delivered yet.
    if (requesterId) {
      if (r.requesterVisibleAt == null) return false;
      return new Date(String(r.requesterVisibleAt)) <= now;
    }
    // No requesterId supplied — show everything (system/admin access)
    return true;
  });

  res.json(
    visible.map((a) => ({
      id: a.id,
      teamCollectionId: a.teamCollectionId,
      articleId: a.articleId,
      addedBy: a.addedBy,
      addedAt: a.addedAt,
      article: a.article,
      isRead: a.completedAt != null,
      completedAt: a.completedAt ?? null,
      sourceArticleId: a.article?.sourceArticleId ?? null,
      // parentInThisCollection uses ALL collection article IDs (including
      // soft-deleted placeholders) so threading survives parent deletion
      parentInThisCollection: a.article?.sourceArticleId
        ? allCollectionArticleIds.has(a.article.sourceArticleId)
        : false,
      isDeletedPlaceholder: a.deletedAt != null,
      visibleAt: a.requesterVisibleAt ?? null,
    })),
  );
});

router.post("/team-collections/:id/articles", async (req, res) => {
  const parsed = AddTeamArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { articleId, addedBy, asNotice } = parsed.data;
  const teamCollectionId = req.params.id;

  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.id, articleId));
  if (!article) {
    res.status(400).json({ error: "Article not found" });
    return;
  }
  if (article.authorId !== addedBy) {
    res.status(400).json({ error: "Can only add own articles to team collections" });
    return;
  }

  // Authorization: sender must be a member of the target team collection.
  const [senderMembership] = await db
    .select()
    .from(teamCollectionMembershipsTable)
    .where(and(
      eq(teamCollectionMembershipsTable.teamCollectionId, teamCollectionId),
      eq(teamCollectionMembershipsTable.userId, addedBy),
    ));
  if (!senderMembership) {
    res.status(403).json({ error: "Not a member of this team collection." });
    return;
  }

  if (asNotice && senderMembership.role !== "OWNER") {
    res.status(400).json({ error: "Only OWNERs can send today's greeting." });
    return;
  }

  const existing = await db.select().from(teamCollectionArticlesTable)
    .where(and(
      eq(teamCollectionArticlesTable.teamCollectionId, teamCollectionId),
      eq(teamCollectionArticlesTable.articleId, articleId),
    ));

  if (existing.length > 0) {
    res.status(400).json({ error: "Article already in collection" });
    return;
  }

  const noticeDate: string | null = asNotice ? computeNoticeDateKST() : null;
  const visibleAt = computeDeliverySlot();

  // Include ALL members (including the sender) so author-visibility is also
  // gated by inbox visibleAt — matching "본인 글도 요청자 inbox visibleAt 이후에만 노출"
  const members = await db
    .select({ userId: teamCollectionMembershipsTable.userId })
    .from(teamCollectionMembershipsTable)
    .where(eq(teamCollectionMembershipsTable.teamCollectionId, teamCollectionId));

  let conflicted = false;
  const entry = await db.transaction(async (tx) => {
    if (asNotice && noticeDate) {
      // Serialize concurrent notice sends for the same (collection, noticeDate)
      // so the one-per-day check + insert is atomic.
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`notice:${teamCollectionId}:${noticeDate}`}, 0))`,
      );

      const conflict = await tx
        .select({ id: articlesTable.id })
        .from(teamCollectionArticlesTable)
        .innerJoin(articlesTable, eq(teamCollectionArticlesTable.articleId, articlesTable.id))
        .where(and(
          eq(teamCollectionArticlesTable.teamCollectionId, teamCollectionId),
          eq(articlesTable.isNotice, true),
          eq(articlesTable.noticeDate, noticeDate),
        ));
      if (conflict.length > 0) {
        conflicted = true;
        return null;
      }

      await tx
        .update(articlesTable)
        .set({ isNotice: true, noticeDate })
        .where(eq(articlesTable.id, articleId));
    }

    const [created] = await tx.insert(teamCollectionArticlesTable).values({
      teamCollectionId,
      articleId,
      addedBy,
    }).returning();

    if (members.length > 0) {
      await tx.insert(inboxTable).values(
        members.map((m) => ({
          recipientId: m.userId,
          articleId,
          senderId: addedBy,
          visibleAt,
        })),
      );
    }

    return created;
  });

  if (conflicted || !entry) {
    res.status(409).json({ error: "Today's greeting was already sent for this collection." });
    return;
  }

  res.status(201).json(entry);
});

router.get("/team-collections/:id/today-greeting-status", async (req, res) => {
  const { userId } = req.query;
  if (typeof userId !== "string" || !UUID_REGEX.test(userId)) {
    res.status(400).json({ error: "userId must be a UUID" });
    return;
  }
  const teamCollectionId = req.params.id;

  const [membership] = await db
    .select()
    .from(teamCollectionMembershipsTable)
    .where(and(
      eq(teamCollectionMembershipsTable.teamCollectionId, teamCollectionId),
      eq(teamCollectionMembershipsTable.userId, userId),
    ));

  const isOwner = !!membership && membership.role === "OWNER";
  const noticeDate = computeNoticeDateKST();

  const existing = await db
    .select({ id: articlesTable.id })
    .from(teamCollectionArticlesTable)
    .innerJoin(articlesTable, eq(teamCollectionArticlesTable.articleId, articlesTable.id))
    .where(and(
      eq(teamCollectionArticlesTable.teamCollectionId, teamCollectionId),
      eq(articlesTable.isNotice, true),
      eq(articlesTable.noticeDate, noticeDate),
    ));

  res.json({
    isOwner,
    alreadySentToday: existing.length > 0,
    noticeDate,
  });
});

router.delete("/team-collections/:teamId/articles/:articleId", async (req, res) => {
  const { teamId, articleId } = req.params;

  const [row] = await db
    .select()
    .from(teamCollectionArticlesTable)
    .where(
      and(
        eq(teamCollectionArticlesTable.teamCollectionId, teamId),
        eq(teamCollectionArticlesTable.articleId, articleId),
      ),
    )
    .limit(1);

  if (!row) {
    res.status(404).json({ error: "Article not in collection" });
    return;
  }

  // Check if this article has live replies in this collection
  // (other team_collection_articles rows whose article.sourceArticleId = articleId and deletedAt IS NULL)
  const liveReplies = await db
    .select({ id: teamCollectionArticlesTable.id })
    .from(teamCollectionArticlesTable)
    .innerJoin(articlesTable, eq(teamCollectionArticlesTable.articleId, articlesTable.id))
    .where(
      and(
        eq(teamCollectionArticlesTable.teamCollectionId, teamId),
        eq(articlesTable.sourceArticleId, articleId),
        isNull(teamCollectionArticlesTable.deletedAt),
      ),
    )
    .limit(1);

  const hasLiveReplies = liveReplies.length > 0;

  await db.transaction(async (tx) => {
    if (hasLiveReplies) {
      // Soft delete: keep the row as a placeholder for child threading
      await tx
        .update(teamCollectionArticlesTable)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(teamCollectionArticlesTable.teamCollectionId, teamId),
            eq(teamCollectionArticlesTable.articleId, articleId),
          ),
        );
    } else {
      // Hard delete: no live replies, remove completely
      await tx
        .delete(teamCollectionArticlesTable)
        .where(
          and(
            eq(teamCollectionArticlesTable.teamCollectionId, teamId),
            eq(teamCollectionArticlesTable.articleId, articleId),
          ),
        );
    }

    // After either branch: if this article is itself a reply, check whether
    // its parent is a soft-deleted placeholder that now has no live replies
    // left.  This handles both:
    //   • hard-delete of a reply (parent may become orphaned placeholder)
    //   • soft-delete of a reply (the deleted reply no longer counts as live,
    //     so the grandparent's placeholder may become orphaned)
    const [article] = await tx
      .select({ sourceArticleId: articlesTable.sourceArticleId })
      .from(articlesTable)
      .where(eq(articlesTable.id, articleId))
      .limit(1);

    if (article?.sourceArticleId) {
      const parentRow = await tx
        .select({ id: teamCollectionArticlesTable.id })
        .from(teamCollectionArticlesTable)
        .where(
          and(
            eq(teamCollectionArticlesTable.teamCollectionId, teamId),
            eq(teamCollectionArticlesTable.articleId, article.sourceArticleId),
            isNotNull(teamCollectionArticlesTable.deletedAt),
          ),
        )
        .limit(1);

      if (parentRow.length > 0) {
        // Parent is a soft-deleted placeholder — check for remaining live replies
        const remainingReplies = await tx
          .select({ id: teamCollectionArticlesTable.id })
          .from(teamCollectionArticlesTable)
          .innerJoin(articlesTable, eq(teamCollectionArticlesTable.articleId, articlesTable.id))
          .where(
            and(
              eq(teamCollectionArticlesTable.teamCollectionId, teamId),
              eq(articlesTable.sourceArticleId, article.sourceArticleId),
              isNull(teamCollectionArticlesTable.deletedAt),
            ),
          )
          .limit(1);

        if (remainingReplies.length === 0) {
          // Parent has no more live replies → remove the orphaned placeholder
          await tx
            .delete(teamCollectionArticlesTable)
            .where(
              and(
                eq(teamCollectionArticlesTable.teamCollectionId, teamId),
                eq(teamCollectionArticlesTable.articleId, article.sourceArticleId),
              ),
            );
        }
      }
    }
  });

  res.status(204).send();
});

export default router;
