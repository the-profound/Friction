import { Router, type IRouter } from "express";
import { and, eq, count } from "drizzle-orm";
import { db, myCollectionsTable, myCollectionArticlesTable, articlesTable } from "@workspace/db";
import { CreateMyCollectionBody, UpdateMyCollectionBody, AddArticleToMyCollectionBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.get("/my-collections", async (req, res) => {
  const { ownerId } = req.query;
  if (!ownerId || typeof ownerId !== "string") {
    res.status(400).json({ error: "ownerId is required" });
    return;
  }

  const [existingArchive] = await db
    .select({ id: myCollectionsTable.id })
    .from(myCollectionsTable)
    .where(and(eq(myCollectionsTable.ownerId, ownerId), eq(myCollectionsTable.isArchive, true)));

  if (!existingArchive) {
    await db
      .insert(myCollectionsTable)
      .values({ ownerId, name: "내 글 모음", isArchive: true })
      .onConflictDoUpdate({
        target: [myCollectionsTable.ownerId, myCollectionsTable.name],
        set: { isArchive: true },
      });
  }

  const collections = await db
    .select({
      id: myCollectionsTable.id,
      ownerId: myCollectionsTable.ownerId,
      name: myCollectionsTable.name,
      description: myCollectionsTable.description,
      isPublic: myCollectionsTable.isPublic,
      isArchive: myCollectionsTable.isArchive,
      coverImageUrl: myCollectionsTable.coverImageUrl,
      createdAt: myCollectionsTable.createdAt,
      updatedAt: myCollectionsTable.updatedAt,
      articleCount: count(myCollectionArticlesTable.id),
    })
    .from(myCollectionsTable)
    .leftJoin(myCollectionArticlesTable, eq(myCollectionsTable.id, myCollectionArticlesTable.myCollectionId))
    .where(eq(myCollectionsTable.ownerId, ownerId))
    .groupBy(myCollectionsTable.id);

  res.json(collections);
});

router.post("/my-collections", async (req, res) => {
  const parsed = CreateMyCollectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { ownerId, name, description, isPublic, coverImageUrl } = parsed.data;

  const [collection] = await db.insert(myCollectionsTable).values({
    ownerId,
    name,
    description: description ?? null,
    isPublic: isPublic ?? false,
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
  await db.delete(myCollectionArticlesTable).where(eq(myCollectionArticlesTable.myCollectionId, req.params.id));
  const [deleted] = await db.delete(myCollectionsTable).where(eq(myCollectionsTable.id, req.params.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Collection not found" });
    return;
  }
  res.status(204).send();
});

router.get("/my-collections/:id/articles", async (req, res) => {
  const articles = await db
    .select({
      id: myCollectionArticlesTable.id,
      myCollectionId: myCollectionArticlesTable.myCollectionId,
      articleId: myCollectionArticlesTable.articleId,
      addedAt: myCollectionArticlesTable.addedAt,
      article: articlesTable,
    })
    .from(myCollectionArticlesTable)
    .leftJoin(articlesTable, eq(myCollectionArticlesTable.articleId, articlesTable.id))
    .where(eq(myCollectionArticlesTable.myCollectionId, req.params.id));

  res.json(articles);
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
