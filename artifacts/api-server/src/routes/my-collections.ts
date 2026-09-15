import { Router, type IRouter } from "express";
import { and, eq, count, sql } from "drizzle-orm";
import { db, myCollectionsTable, myCollectionArticlesTable, articlesTable, usersTable } from "@workspace/db";
import { resolveMyCollectionArticleAuthorIdentity } from "../lib/myCollectionArticleIdentity";

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

// Personal collections (notably the built-in "인상깊은 편지" collection) can hold
// letters authored by other users. When such a letter originated from a Space,
// these three subqueries resolve that Space's name/anonymity/safe display name
// so the route can avoid ever exposing a real account nickname for a letter the
// collection owner did not author themselves in an anonymous Space — mirrors the
// masking rule in GET /users/:id/space-letters and GET /spaces/:id/letters.
const articleSpaceNameSubquery = sql<string | null>`(
  SELECT s.name
  FROM space_letters sl
  JOIN spaces s ON sl.space_id = s.id
  WHERE sl.source_article_id = ${articlesTable.id}
  ORDER BY sl.created_at ASC
  LIMIT 1
)`;

// Paired with articleSpaceNameSubquery above (identical FROM/JOIN/WHERE/ORDER
// BY/LIMIT) so the name and ID always resolve from the same space_letters
// row — never resolve one from this route and the other from a client-side
// map keyed by different selection criteria, or the displayed Space name can
// point at a different Space's ID.
const articleSpaceIdSubquery = sql<string | null>`(
  SELECT s.id
  FROM space_letters sl
  JOIN spaces s ON sl.space_id = s.id
  WHERE sl.source_article_id = ${articlesTable.id}
  ORDER BY sl.created_at ASC
  LIMIT 1
)`;

// The same article can back more than one space_letters row (e.g. resubmitted
// into a second space). Any one of them being anonymous is enough to require
// masking — picking only the earliest row would let a later anonymous
// submission's real nickname leak through the earliest, non-anonymous one.
const articleSpaceIsAnonymousSubquery = sql<boolean | null>`(
  SELECT bool_or(s.is_anonymous)
  FROM space_letters sl
  JOIN spaces s ON sl.space_id = s.id
  WHERE sl.source_article_id = ${articlesTable.id}
)`;

// Once masking is required, pull the safe alias specifically from an
// anonymous match (never from a non-anonymous one, which could have a
// different, non-masked nickname value for the same author/article).
const articleSpaceAuthorSpaceNicknameSubquery = sql<string | null>`(
  SELECT sp.space_nickname
  FROM space_letters sl
  JOIN spaces s ON sl.space_id = s.id
  LEFT JOIN space_participations sp
    ON sp.space_id = sl.space_id AND sp.user_id = sl.author_id
  WHERE sl.source_article_id = ${articlesTable.id}
    AND s.is_anonymous = true
  ORDER BY sl.created_at ASC
  LIMIT 1
)`;
import { CreateMyCollectionBody, UpdateMyCollectionBody, AddArticleToMyCollectionBody } from "@workspace/api-zod";
import { ensureImpressionCollection, IMPRESSION_COLLECTION_NAME } from "../lib/impressionCollection";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/my-collections", requireAuth, async (req, res) => {
  const { ownerId } = req.query;
  const articleIdParam = req.query.articleId;
  if (!ownerId || typeof ownerId !== "string") {
    res.status(400).json({ error: "ownerId is required" });
    return;
  }
  if (req.user?.id !== ownerId) {
    res.status(403).json({ error: "Cannot list another user's collections" });
    return;
  }
  if (articleIdParam !== undefined && typeof articleIdParam !== "string") {
    res.status(400).json({ error: "articleId must be a string" });
    return;
  }
  const articleId = articleIdParam;

  await ensureImpressionCollection(ownerId);

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
  const resolvedName = isImpression ? IMPRESSION_COLLECTION_NAME : name;

  const [collection] = await db.insert(myCollectionsTable).values({
    ownerId,
    name: resolvedName,
    description: description ?? null,
    isPublic: isImpression ? false : (isPublic ?? false),
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

router.get("/my-collections/:id/articles", requireAuth, async (req, res) => {
  // Needed to tell "the owner's own letter" apart from "someone else's letter
  // the owner saved" — only the latter can require anonymous-Space masking.
  // Also the sole access-control check: this endpoint can return a foreign
  // author's real identity metadata for non-anonymous letters, so only the
  // collection's own owner may list its contents — there is no "public
  // collection browsing" flow for this route today.
  const [collection] = await db
    .select({ ownerId: myCollectionsTable.ownerId })
    .from(myCollectionsTable)
    .where(eq(myCollectionsTable.id, req.params.id));

  if (!collection) {
    res.status(404).json({ error: "Collection not found" });
    return;
  }
  if (collection.ownerId !== req.user!.id) {
    res.status(403).json({ error: "Cannot view another user's collection" });
    return;
  }

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
      spaceName: articleSpaceNameSubquery,
      spaceId: articleSpaceIdSubquery,
      spaceIsAnonymous: articleSpaceIsAnonymousSubquery,
      spaceAuthorSpaceNickname: articleSpaceAuthorSpaceNicknameSubquery,
    })
    .from(myCollectionArticlesTable)
    .leftJoin(articlesTable, eq(myCollectionArticlesTable.articleId, articlesTable.id))
    .leftJoin(usersTable, eq(articlesTable.authorId, usersTable.id))
    .where(eq(myCollectionArticlesTable.myCollectionId, req.params.id));

  res.json(rows.map((row) => {
    const { authorNickname: safeAuthorNickname, authorIdentityMasked } =
      resolveMyCollectionArticleAuthorIdentity({
        articleAuthorId: row.article?.authorId ?? null,
        collectionOwnerId: collection?.ownerId ?? null,
        rawAuthorNickname: row.authorNickname ?? null,
        spaceIsAnonymous: row.spaceIsAnonymous,
        spaceAuthorSpaceNickname: row.spaceAuthorSpaceNickname,
      });

    return {
      id: row.id,
      myCollectionId: row.myCollectionId,
      articleId: row.articleId,
      addedAt: row.addedAt,
      article: row.article ? {
        ...row.article,
        // Never return the real author ID alongside a masked nickname: the
        // client can resolve a nickname from an ID just as easily as reading
        // it directly, so a masked entry must hide identity end-to-end, not
        // rely on the UI choosing not to use the ID.
        authorId: authorIdentityMasked ? null : row.article.authorId,
        authorNickname: safeAuthorNickname,
        collectionName: row.collectionName ?? null,
        collectionId: row.collectionId ?? null,
        spaceName: row.spaceName ?? null,
        spaceId: row.spaceId ?? null,
        authorIdentityMasked,
      } : null,
    };
  }));
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
