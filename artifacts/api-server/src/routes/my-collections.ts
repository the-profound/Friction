import { Router, type IRouter } from "express";
import { and, eq, count, sql } from "drizzle-orm";
import { db, myCollectionsTable, myCollectionArticlesTable, articlesTable, usersTable } from "@workspace/db";

// Mirrors articleCollectionNameSubquery in articles.ts — team collection wins,
// personal collection is the fallback (same resolution order as GET /articles/:id).
const articleCollectionNameSubquery = sql<string | null>`(
  COALESCE(
    (
      SELECT tc.name
      FROM team_collection_articles tca
      JOIN team_collections tc ON tca.team_collection_id = tc.id
      WHERE tca.article_id = ${articlesTable.id}
      ORDER BY tca.added_at ASC
      LIMIT 1
    ),
    (
      SELECT mc.name
      FROM my_collection_articles mca
      JOIN my_collections mc ON mca.my_collection_id = mc.id
      WHERE mca.article_id = ${articlesTable.id}
      ORDER BY mca.added_at ASC
      LIMIT 1
    )
  )
)`;

// Only team collections are navigable — personal-only articles resolve to NULL.
const articleCollectionIdSubquery = sql<string | null>`(
  SELECT tca.team_collection_id
  FROM team_collection_articles tca
  WHERE tca.article_id = ${articlesTable.id}
  ORDER BY tca.added_at ASC
  LIMIT 1
)`;
import { CreateMyCollectionBody, UpdateMyCollectionBody, AddArticleToMyCollectionBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/my-collections", async (req, res) => {
  const { ownerId } = req.query;
  const articleIdParam = req.query.articleId;
  if (!ownerId || typeof ownerId !== "string") {
    res.status(400).json({ error: "ownerId is required" });
    return;
  }
  if (articleIdParam !== undefined && typeof articleIdParam !== "string") {
    res.status(400).json({ error: "articleId must be a string" });
    return;
  }
  const articleId = articleIdParam;

  const collections = await db
    .select({
      id: myCollectionsTable.id,
      ownerId: myCollectionsTable.ownerId,
      name: myCollectionsTable.name,
      description: myCollectionsTable.description,
      isPublic: myCollectionsTable.isPublic,
      isArchive: myCollectionsTable.isArchive,
      isImpression: myCollectionsTable.isImpression,
      coverImageUrl: myCollectionsTable.coverImageUrl,
      createdAt: myCollectionsTable.createdAt,
      updatedAt: myCollectionsTable.updatedAt,
      articleCount: count(myCollectionArticlesTable.id),
      containsArticle: articleId
        ? sql<boolean>`EXISTS (
            SELECT 1
            FROM ${myCollectionArticlesTable} AS requested_article
            WHERE requested_article.my_collection_id = ${myCollectionsTable.id}
              AND requested_article.article_id = ${articleId}
          )`
        : sql<boolean>`false`,
    })
    .from(myCollectionsTable)
    .leftJoin(myCollectionArticlesTable, eq(myCollectionsTable.id, myCollectionArticlesTable.myCollectionId))
    .where(eq(myCollectionsTable.ownerId, ownerId))
    .groupBy(myCollectionsTable.id);

  res.json(articleId
    ? collections
    : collections.map(({ containsArticle: _containsArticle, ...collection }) => collection));
});

router.post("/my-collections", async (req, res) => {
  const parsed = CreateMyCollectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { ownerId, name, description, isPublic, isImpression, coverImageUrl } = parsed.data;
  const resolvedName = isImpression ? "인상깊은 편지" : name;

  const [collection] = await db.insert(myCollectionsTable).values({
    ownerId,
    name: resolvedName,
    description: description ?? null,
    isPublic: isPublic ?? false,
    isImpression: isImpression ?? false,
    coverImageUrl: coverImageUrl ?? null,
  }).returning();
  res.status(201).json({ ...collection, articleCount: 0 });
});

router.get("/my-collections/:id", async (req, res) => {
  const results = await db
    .select({
      id: myCollectionsTable.id,
      ownerId: myCollectionsTable.ownerId,
      name: myCollectionsTable.name,
      description: myCollectionsTable.description,
      isPublic: myCollectionsTable.isPublic,
      isArchive: myCollectionsTable.isArchive,
      isImpression: myCollectionsTable.isImpression,
      coverImageUrl: myCollectionsTable.coverImageUrl,
      createdAt: myCollectionsTable.createdAt,
      updatedAt: myCollectionsTable.updatedAt,
      articleCount: count(myCollectionArticlesTable.id),
    })
    .from(myCollectionsTable)
    .leftJoin(myCollectionArticlesTable, eq(myCollectionsTable.id, myCollectionArticlesTable.myCollectionId))
    .where(eq(myCollectionsTable.id, req.params.id))
    .groupBy(myCollectionsTable.id);

  if (!results[0]) {
    res.status(404).json({ error: "Collection not found" });
    return;
  }
  res.json(results[0]);
});

router.patch("/my-collections/:id", async (req, res) => {
  const parsed = UpdateMyCollectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const [existing] = await db.select({ id: myCollectionsTable.id, isImpression: myCollectionsTable.isImpression })
    .from(myCollectionsTable)
    .where(eq(myCollectionsTable.id, req.params.id));
  if (!existing) {
    res.status(404).json({ error: "Collection not found" });
    return;
  }
  if (existing.isImpression && parsed.data.name !== undefined) {
    res.status(403).json({ error: "인상깊은 편지 폴더의 이름은 변경할 수 없습니다." });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.name !== undefined) updates.name = parsed.data.name;
  if (parsed.data.description !== undefined) updates.description = parsed.data.description;
  if (parsed.data.isPublic !== undefined) updates.isPublic = parsed.data.isPublic;
  if (parsed.data.coverImageUrl !== undefined) updates.coverImageUrl = parsed.data.coverImageUrl;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [collection] = await db.update(myCollectionsTable).set(updates).where(eq(myCollectionsTable.id, req.params.id)).returning();
  if (!collection) {
    res.status(404).json({ error: "Collection not found" });
    return;
  }
  res.json(collection);
});

router.delete("/my-collections/:id", async (req, res) => {
  const [existing] = await db.select({ id: myCollectionsTable.id, isImpression: myCollectionsTable.isImpression })
    .from(myCollectionsTable)
    .where(eq(myCollectionsTable.id, req.params.id));
  if (!existing) {
    res.status(404).json({ error: "Collection not found" });
    return;
  }
  if (existing.isImpression) {
    res.status(403).json({ error: "인상깊은 편지 폴더는 삭제할 수 없습니다." });
    return;
  }
  await db.delete(myCollectionArticlesTable).where(eq(myCollectionArticlesTable.myCollectionId, req.params.id));
  const [deleted] = await db.delete(myCollectionsTable).where(eq(myCollectionsTable.id, req.params.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Collection not found" });
    return;
  }
  res.status(204).send();
});

router.get("/my-collections/:id/articles", async (req, res) => {
  const rows = await db
    .select({
      id: myCollectionArticlesTable.id,
      myCollectionId: myCollectionArticlesTable.myCollectionId,
      articleId: myCollectionArticlesTable.articleId,
      addedAt: myCollectionArticlesTable.addedAt,
      article: articlesTable,
      authorNickname: usersTable.nickname,
      collectionName: articleCollectionNameSubquery,
      collectionId: articleCollectionIdSubquery,
    })
    .from(myCollectionArticlesTable)
    .leftJoin(articlesTable, eq(myCollectionArticlesTable.articleId, articlesTable.id))
    .leftJoin(usersTable, eq(articlesTable.authorId, usersTable.id))
    .where(eq(myCollectionArticlesTable.myCollectionId, req.params.id));

  res.json(rows.map((row) => ({
    id: row.id,
    myCollectionId: row.myCollectionId,
    articleId: row.articleId,
    addedAt: row.addedAt,
    article: row.article ? {
      ...row.article,
      authorNickname: row.authorNickname ?? null,
      collectionName: row.collectionName ?? null,
      collectionId: row.collectionId ?? null,
    } : null,
  })));
});

router.post("/my-collections/:id/articles", async (req, res) => {
  const parsed = AddArticleToMyCollectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { articleId } = parsed.data;

  const existing = await db.select().from(myCollectionArticlesTable)
    .where(and(
      eq(myCollectionArticlesTable.myCollectionId, req.params.id),
      eq(myCollectionArticlesTable.articleId, articleId),
    ));

  if (existing.length > 0) {
    res.status(400).json({ error: "Article already in collection" });
    return;
  }

  const [entry] = await db.insert(myCollectionArticlesTable).values({
    myCollectionId: req.params.id,
    articleId,
  }).returning();
  res.status(201).json(entry);
});

router.delete("/my-collections/:collectionId/articles/:articleId", async (req, res) => {
  const [deleted] = await db.delete(myCollectionArticlesTable)
    .where(and(
      eq(myCollectionArticlesTable.myCollectionId, req.params.collectionId),
      eq(myCollectionArticlesTable.articleId, req.params.articleId),
    ))
    .returning();

  if (!deleted) {
    res.status(404).json({ error: "Article not in collection" });
    return;
  }
  res.status(204).send();
});

export default router;
