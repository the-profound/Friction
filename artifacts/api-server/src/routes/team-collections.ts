import { Router, type IRouter } from "express";
import { and, eq, count, gt, isNull } from "drizzle-orm";
import {
  db,
  teamCollectionsTable,
  teamCollectionMembershipsTable,
  teamCollectionArticlesTable,
  articlesTable,
  usersTable,
  inboxTable,
} from "@workspace/db";
import {
  CreateTeamCollectionBody,
  UpdateTeamCollectionBody,
  AddTeamMemberBody,
  AddTeamArticleBody,
} from "@workspace/api-zod";

const router: IRouter = Router();

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

  const [collection] = await db.insert(teamCollectionsTable).values({
    name,
    description: description ?? null,
    creatorId,
  }).returning();

  await db.insert(teamCollectionMembershipsTable).values({
    teamCollectionId: collection.id,
    userId: creatorId,
    role: "OWNER",
  });

  res.status(201).json(collection);
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

router.get("/team-collections/:id/articles", async (req, res) => {
  const now = new Date();

  const articles = await db
    .select({
      id: teamCollectionArticlesTable.id,
      teamCollectionId: teamCollectionArticlesTable.teamCollectionId,
      articleId: teamCollectionArticlesTable.articleId,
      addedBy: teamCollectionArticlesTable.addedBy,
      addedAt: teamCollectionArticlesTable.addedAt,
      article: articlesTable,
    })
    .from(teamCollectionArticlesTable)
    .leftJoin(articlesTable, eq(teamCollectionArticlesTable.articleId, articlesTable.id))
    .leftJoin(
      inboxTable,
      and(
        eq(inboxTable.articleId, teamCollectionArticlesTable.articleId),
        gt(inboxTable.visibleAt, now),
      ),
    )
    .where(
      and(
        eq(teamCollectionArticlesTable.teamCollectionId, req.params.id),
        isNull(inboxTable.id),
      ),
    );

  res.json(articles);
});

router.post("/team-collections/:id/articles", async (req, res) => {
  const parsed = AddTeamArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { articleId, addedBy } = parsed.data;

  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.id, articleId));
  if (!article) {
    res.status(400).json({ error: "Article not found" });
    return;
  }
  if (article.authorId !== addedBy) {
    res.status(400).json({ error: "Can only add own articles to team collections" });
    return;
  }

  const existing = await db.select().from(teamCollectionArticlesTable)
    .where(and(
      eq(teamCollectionArticlesTable.teamCollectionId, req.params.id),
      eq(teamCollectionArticlesTable.articleId, articleId),
    ));

  if (existing.length > 0) {
    res.status(400).json({ error: "Article already in collection" });
    return;
  }

  const [entry] = await db.insert(teamCollectionArticlesTable).values({
    teamCollectionId: req.params.id,
    articleId,
    addedBy,
  }).returning();
  res.status(201).json(entry);
});

router.delete("/team-collections/:teamId/articles/:articleId", async (req, res) => {
  const [deleted] = await db.delete(teamCollectionArticlesTable)
    .where(and(
      eq(teamCollectionArticlesTable.teamCollectionId, req.params.teamId),
      eq(teamCollectionArticlesTable.articleId, req.params.articleId),
    ))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Article not in collection" });
    return;
  }
  res.status(204).send();
});

export default router;
