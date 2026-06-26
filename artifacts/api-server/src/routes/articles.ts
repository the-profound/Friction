import { Router, type IRouter } from "express";
import { and, eq, ilike, ne, sql } from "drizzle-orm";
import { db, articlesTable, myCollectionArticlesTable, myCollectionsTable, usersTable, type ArticleStatus } from "@workspace/db";
import { CreateArticleBody, UpdateArticleBody, TransitionArticleStatusBody, FinalizeArticleBody, ReadingMemoQueryParams } from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";

// Resolves a display collection name for a standalone article fetched via
// getArticle. Team-collection membership is preferred (matches the chain
// delivery context); personal-collection membership is the fallback.
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

// Resolves the team-collection id an article was delivered through, used for
// navigation to the collection detail. Only team collections are navigable, so
// personal-only / 1:1 articles resolve to NULL (name may still display).
const articleCollectionIdSubquery = sql<string | null>`(
  SELECT tca.team_collection_id
  FROM team_collection_articles tca
  WHERE tca.article_id = ${articlesTable.id}
  ORDER BY tca.added_at ASC
  LIMIT 1
)`;

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
  const parsed = ReadingMemoQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { userId, sourceArticleId } = parsed.data;

  const [existingMemo] = await db
    .select()
    .from(articlesTable)
    .where(
      and(
        eq(articlesTable.authorId, userId),
        eq(articlesTable.sourceArticleId, sourceArticleId),
        eq(articlesTable.status, "DRAFT"),
      ),
    );

  if (!existingMemo) {
    res.status(404).json({ error: "Reading memo not found" });
    return;
  }
  res.json(existingMemo);
});

router.get("/articles", async (req, res) => {
  const { authorId, status, titleQuery } = req.query;
  const conditions = [];
  if (authorId) conditions.push(eq(articlesTable.authorId, authorId as string));
  if (status) conditions.push(eq(articlesTable.status, status as ArticleStatus));
  if (titleQuery) conditions.push(ilike(articlesTable.title, `%${titleQuery as string}%`));

  const baseQuery = db
    .select({
      article: articlesTable,
      authorNickname: usersTable.nickname,
    })
    .from(articlesTable)
    .leftJoin(usersTable, eq(usersTable.id, articlesTable.authorId));

  const rows = conditions.length > 0
    ? await baseQuery.where(and(...conditions))
    : await baseQuery;

  const articles = rows.map((r) => ({
    ...r.article,
    authorNickname: r.authorNickname ?? null,
  }));
  res.json(articles);
});

router.post("/articles", async (req, res) => {
  const parsed = CreateArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { authorId, content, sourceArticleId } = parsed.data;
  let { title } = parsed.data;

  // 읽기 메모 자동 제목: 클라이언트가 별도 제목을 지정하지 않은 경우(빈 문자열이거나
  // 기본 placeholder "읽기 메모")에만 서버가 "읽기 메모 — {원글 제목}" 형식으로
  // 채워준다. 사용자가 MemoBottomSheet 등에서 별도 제목을 지정한 경우에는
  // 그 제목을 그대로 보존해 기록함에서도 동일하게 노출되도록 한다.
  if (sourceArticleId) {
    const trimmedTitle = title.trim();
    const isPlaceholderTitle = trimmedTitle === "" || trimmedTitle === "읽기 메모";
    if (isPlaceholderTitle) {
      const [sourceArticle] = await db
        .select()
        .from(articlesTable)
        .where(eq(articlesTable.id, sourceArticleId));
      if (sourceArticle) {
        title = `읽기 메모 — ${sourceArticle.title}`;
      }
    }
  }

  const article = await db.transaction(async (tx) => {
    if (sourceArticleId) {
      // Intentionally unlink all prior source-linked drafts for this (author, source) pair before
      // inserting the new one. This satisfies the unique index on (authorId, sourceArticleId) and
      // implements the "always start a fresh memo per re-read" policy — old memos are preserved in
      // the archive but are no longer linked to this source article.
      await tx
        .update(articlesTable)
        .set({ sourceArticleId: null })
        .where(
          and(
            eq(articlesTable.authorId, authorId),
            eq(articlesTable.sourceArticleId, sourceArticleId),
          ),
        );
    }

    const [created] = await tx.insert(articlesTable).values({
      authorId,
      title,
      content: content ?? "",
      status: "DRAFT",
      ...(sourceArticleId ? { sourceArticleId } : {}),
    }).returning();
    return created;
  });

  res.status(201).json(article);
});

router.get("/articles/:id", async (req, res) => {
  const [row] = await db
    .select({
      article: articlesTable,
      authorNickname: usersTable.nickname,
      collectionName: articleCollectionNameSubquery,
      collectionId: articleCollectionIdSubquery,
    })
    .from(articlesTable)
    .leftJoin(usersTable, eq(usersTable.id, articlesTable.authorId))
    .where(eq(articlesTable.id, req.params.id));
  if (!row) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  res.json({
    ...row.article,
    authorNickname: row.authorNickname ?? null,
    collectionName: row.collectionName ?? null,
    collectionId: row.collectionId ?? null,
  });
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
  if (parsed.data.content !== undefined) {
    updates.content = parsed.data.content;
    req.log.info({ articleId: req.params.id, contentLen: (parsed.data.content ?? "").length, contentPreview: (parsed.data.content ?? "").slice(0, 80) }, "PATCH content payload");
  }
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

router.post("/articles/:id/finalize", async (req, res) => {
  const parsed = FinalizeArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { myCollectionId } = parsed.data;
  const articleId = req.params.id;

  try {
    const result = await db.transaction(async (tx) => {
      const [article] = await tx.select().from(articlesTable).where(eq(articlesTable.id, articleId));
      if (!article) {
        return { status: 404, body: { error: "Article not found" } } as const;
      }

      let updatedArticle = article;
      if (article.status === "CLOSING") {
        const [updated] = await tx
          .update(articlesTable)
          .set({ status: "LETTER", letterAt: new Date() })
          .where(eq(articlesTable.id, articleId))
          .returning();
        updatedArticle = updated;
      } else if (article.status !== "LETTER") {
        return {
          status: 400,
          body: {
            error: `Invalid transition: ${article.status} → LETTER. Only CLOSING articles can be finalized.`,
          },
        } as const;
      }

      if (myCollectionId) {
        const [collection] = await tx.select().from(myCollectionsTable).where(eq(myCollectionsTable.id, myCollectionId));
        if (!collection) {
          return { status: 404, body: { error: "Collection not found" } } as const;
        }

        const existingLink = await tx
          .select({ id: myCollectionArticlesTable.id })
          .from(myCollectionArticlesTable)
          .where(
            and(
              eq(myCollectionArticlesTable.myCollectionId, myCollectionId),
              eq(myCollectionArticlesTable.articleId, articleId),
            ),
          );
        if (existingLink.length === 0) {
          await tx.insert(myCollectionArticlesTable).values({
            myCollectionId,
            articleId,
          });
        }
      }

      return { status: 200, body: updatedArticle } as const;
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    req.log.error({ err: error }, "Error finalizing article");
    res.status(500).json({ error: "Failed to finalize article" });
  }
});

export default router;
