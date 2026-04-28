import { Router, type IRouter } from "express";
import { and, eq, ilike, ne } from "drizzle-orm";
import { db, articlesTable, type ArticleStatus } from "@workspace/db";
import { CreateArticleBody, UpdateArticleBody, TransitionArticleStatusBody, GetOrCreateReadingMemoQueryParams } from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

const FORWARD_TRANSITIONS: Record<string, string> = {
  DRAFT: "DIVIDING",
  DIVIDING: "CLOSING",
  CLOSING: "LETTER",
};

const BACK_TRANSITIONS: Record<string, string> = {
  DIVIDING: "DRAFT",
  CLOSING: "DIVIDING",
};

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();

router.get("/articles/reading-memo", async (req, res) => {
  const parsed = GetOrCreateReadingMemoQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { userId, sourceArticleId } = parsed.data;

  const [sourceArticle] = await db.select().from(articlesTable).where(eq(articlesTable.id, sourceArticleId));
  if (!sourceArticle) {
    res.status(404).json({ error: "Source article not found" });
    return;
  }

  const memoTitle = `읽기 메모 — ${sourceArticle.title}`;

  const draftMemoCondition = and(
    eq(articlesTable.authorId, userId),
    eq(articlesTable.sourceArticleId, sourceArticleId),
    eq(articlesTable.status, "DRAFT"),
  );
  const anyMemoCondition = and(
    eq(articlesTable.authorId, userId),
    eq(articlesTable.sourceArticleId, sourceArticleId),
  );

  const memo = await db.transaction(async (tx) => {
    const [existingDraft] = await tx.select().from(articlesTable).where(draftMemoCondition);

    if (existingDraft) return existingDraft;

    const [created] = await tx
      .insert(articlesTable)
      .values({
        authorId: userId,
        title: memoTitle,
        content: "",
        status: "DRAFT",
        sourceArticleId,
      })
      .onConflictDoNothing()
      .returning();

    if (created) return created;

    const [afterConflict] = await tx.select().from(articlesTable).where(anyMemoCondition);
    return afterConflict;
  });

  if (!memo) {
    res.status(500).json({ error: "Failed to get or create reading memo" });
    return;
  }
  res.json(memo);
});

router.get("/articles", async (req, res) => {
  const { authorId, status, titleQuery } = req.query;
  const conditions = [];
  if (authorId) conditions.push(eq(articlesTable.authorId, authorId as string));
  if (status) conditions.push(eq(articlesTable.status, status as ArticleStatus));
  if (titleQuery) conditions.push(ilike(articlesTable.title, `%${titleQuery as string}%`));

  const articles = conditions.length > 0
    ? await db.select().from(articlesTable).where(and(...conditions))
    : await db.select().from(articlesTable);
  res.json(articles);
});

router.post("/articles", async (req, res) => {
  const parsed = CreateArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { authorId, title, content } = parsed.data;
  const [article] = await db.insert(articlesTable).values({
    authorId,
    title,
    content: content ?? "",
    status: "DRAFT",
  }).returning();
  res.status(201).json(article);
});

router.get("/articles/:id", async (req, res) => {
  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.id, req.params.id));
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  res.json(article);
});

router.patch("/articles/:id", async (req, res) => {
  const [existing] = await db.select().from(articlesTable).where(eq(articlesTable.id, req.params.id));
  if (!existing) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (existing.status === "LETTER") {
    res.status(400).json({ error: "Cannot modify a LETTER article" });
    return;
  }

  const parsed = UpdateArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const updates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.content !== undefined) updates.content = parsed.data.content;
  if (parsed.data.pages !== undefined) updates.pages = parsed.data.pages;
  if (parsed.data.layoutWidth !== undefined) updates.layoutWidth = parsed.data.layoutWidth;
  if (parsed.data.style !== undefined) updates.style = parsed.data.style;
  if (parsed.data.cover !== undefined) updates.cover = parsed.data.cover;
  if ("sourceArticleId" in parsed.data) updates.sourceArticleId = parsed.data.sourceArticleId;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const newSourceArticleId = updates.sourceArticleId as string | null | undefined;
  const article = await db.transaction(async (tx) => {
    if (newSourceArticleId) {
      await tx
        .update(articlesTable)
        .set({ sourceArticleId: null })
        .where(
          and(
            eq(articlesTable.authorId, existing.authorId),
            eq(articlesTable.sourceArticleId, newSourceArticleId),
            ne(articlesTable.id, req.params.id),
          ),
        );
    }
    const [updated] = await tx.update(articlesTable).set(updates).where(eq(articlesTable.id, req.params.id)).returning();
    return updated;
  });
  res.json(article);
});

router.post("/articles/:id/cover-image", async (req, res) => {
  const { id } = req.params;
  const { name, size, contentType } = req.body ?? {};

  if (!name || !contentType || typeof size !== "number") {
    res.status(400).json({ error: "name, size, and contentType are required" });
    return;
  }
  if (!contentType.startsWith("image/")) {
    res.status(400).json({ error: "contentType must be an image MIME type" });
    return;
  }
  const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
  if (size > MAX_IMAGE_SIZE) {
    res.status(400).json({ error: "Image size must not exceed 10MB" });
    return;
  }

  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.id, id));
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (article.status === "LETTER") {
    res.status(400).json({ error: "Cannot change cover image of a finalized letter" });
    return;
  }

  try {
    const uploadURL = await objectStorageService.getObjectEntityUploadURL();
    const objectPath = objectStorageService.normalizeObjectEntityPath(uploadURL);
    const imageUrl = `/api/storage${objectPath}`;
    res.json({ uploadURL, imageUrl });
  } catch (error) {
    req.log.error({ err: error }, "Error generating cover image upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.delete("/articles/:id", async (req, res) => {
  const [deleted] = await db.delete(articlesTable).where(eq(articlesTable.id, req.params.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  res.status(204).send();
});

router.post("/articles/:id/transition", async (req, res) => {
  const parsed = TransitionArticleStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { targetStatus } = parsed.data;

  const [article] = await db.select().from(articlesTable).where(eq(articlesTable.id, req.params.id));
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  const isForward = FORWARD_TRANSITIONS[article.status] === targetStatus;
  const isBack = BACK_TRANSITIONS[article.status] === targetStatus;

  if (!isForward && !isBack) {
    res.status(400).json({
      error: `Invalid transition: ${article.status} → ${targetStatus}. Allowed: forward or 1-step back.`,
    });
    return;
  }

  if (isForward && targetStatus === "DIVIDING" && (!article.content || article.content.trim() === "")) {
    res.status(400).json({ error: "Cannot transition to DIVIDING: content is empty" });
    return;
  }

  const updates: Record<string, unknown> = { status: targetStatus };
  if (isForward && targetStatus === "CLOSING") {
    if (!article.pages || !Array.isArray(article.pages) || (article.pages as string[]).length === 0) {
      const content = article.content || "";
      const pageTexts = content.split("---").map((p: string) => p.trim()).filter((p: string) => p.length > 0);
      updates.pages = pageTexts.length > 0 ? pageTexts : [content];
    }
  }
  if (isForward && targetStatus === "LETTER") {
    updates.letterAt = new Date();
  }
  if (isBack) {
    if (targetStatus === "DRAFT") {
      updates.pages = null;
    }
  }

  if (isForward && targetStatus === "LETTER") {
    const [updated] = await db
      .update(articlesTable)
      .set(updates)
      .where(eq(articlesTable.id, req.params.id))
      .returning();
    res.json(updated);
    return;
  }

  const [updated] = await db.update(articlesTable).set(updates).where(eq(articlesTable.id, req.params.id)).returning();
  res.json(updated);
});

export default router;
