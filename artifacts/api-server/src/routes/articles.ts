import { Router, type IRouter } from "express";
import { and, eq, ilike, isNull, sql } from "drizzle-orm";
import { db, articlesTable, myCollectionArticlesTable, myCollectionsTable, usersTable, type ArticleStatus } from "@workspace/db";
import {
  UpdateArticleBody,
  TransitionArticleStatusBody,
  FinalizeArticleBody,
  RequestArticleCoverUploadUrlBody,
  RequestArticleCoverUploadUrlResponse,
  VerifyArticleCoverUploadBody,
  VerifyArticleCoverUploadResponse,
} from "@workspace/api-zod";
import {
  InvalidCoverImageError,
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";
import { generateArticleQuestions, getArticleQuestionsOrFallback } from "../services/generate-article-questions";
import { requireAuth } from "../middlewares/requireAuth";

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
  DIVIDING: "CLOSING",
  CLOSING: "LETTER",
};

const BACK_TRANSITIONS: Record<string, string> = {
  CLOSING: "DIVIDING",
};

const router: IRouter = Router();
const objectStorageService = new ObjectStorageService();
const MAX_COVER_IMAGE_BYTES = 10 * 1024 * 1024;

async function findEditableOwnedArticle(
  articleId: string,
  userId: string,
): Promise<{ status: string } | "not-found" | "forbidden"> {
  const [article] = await db
    .select()
    .from(articlesTable)
    .where(and(eq(articlesTable.id, articleId), visibleArticleStatus, isNull(articlesTable.deletedAt)));
  if (!article) return "not-found";
  if (article.authorId !== userId) return "forbidden";
  return { status: article.status };
}
const visibleArticleStatus = sql`${articlesTable.status} IN ('DIVIDING', 'CLOSING', 'LETTER')`;

router.get("/articles", requireAuth, async (req, res) => {
  const { authorId, status, titleQuery } = req.query;
  const conditions = [];
  if (authorId) conditions.push(eq(articlesTable.authorId, authorId as string));
  if (status) {
    // DRAFT records are hidden — only post-promotion statuses are exposed.
    const validStatuses: ArticleStatus[] = ["DIVIDING", "CLOSING", "LETTER"];
    if (validStatuses.includes(status as ArticleStatus)) {
      conditions.push(eq(articlesTable.status, status as ArticleStatus));
    } else {
      res.json([]);
      return;
    }
  } else {
    // Always exclude DRAFT rows; their content lives in thoughts.
    conditions.push(visibleArticleStatus);
  }
  if (titleQuery) conditions.push(ilike(articlesTable.title, `%${titleQuery as string}%`));

  conditions.push(isNull(articlesTable.deletedAt));

  const rows = await db
    .select({
      article: articlesTable,
      authorNickname: usersTable.nickname,
    })
    .from(articlesTable)
    .leftJoin(usersTable, eq(usersTable.id, articlesTable.authorId))
    .where(and(...conditions));

  const articles = rows.map((r) => ({
    ...r.article,
    authorNickname: r.authorNickname ?? null,
  }));

  res.json(articles);
});

router.get("/articles/:id", requireAuth, async (req, res) => {
  const [row] = await db
    .select({
      article: articlesTable,
      authorNickname: usersTable.nickname,
      collectionName: articleCollectionNameSubquery,
      collectionId: articleCollectionIdSubquery,
    })
    .from(articlesTable)
    .leftJoin(usersTable, eq(usersTable.id, articlesTable.authorId))
    .where(and(eq(articlesTable.id, req.params.id), visibleArticleStatus, isNull(articlesTable.deletedAt)));

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

router.patch("/articles/:id", requireAuth, async (req, res) => {
  const [existing] = await db
    .select()
    .from(articlesTable)
    .where(and(eq(articlesTable.id, req.params.id), visibleArticleStatus, isNull(articlesTable.deletedAt)));

  if (!existing) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  if (existing.authorId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
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
            sql`${articlesTable.id} != ${req.params.id}`,
          ),
        );
    }
    const [updated] = await tx.update(articlesTable).set(updates).where(eq(articlesTable.id, req.params.id)).returning();
    return updated;
  });
  res.json(article);
});

router.post("/articles/:id/cover-image", requireAuth, async (req, res) => {
  const { id } = req.params;
  const parsed = RequestArticleCoverUploadUrlBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid cover image metadata",
    });
    return;
  }
  const { contentType } = parsed.data;
  if (!contentType.startsWith("image/")) {
    res.status(400).json({ error: "contentType must be an image MIME type" });
    return;
  }

  const article = await findEditableOwnedArticle(id, req.user!.id);
  if (article === "not-found") {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (article === "forbidden") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (article.status === "LETTER") {
    res.status(400).json({ error: "Cannot change cover image of a finalized letter" });
    return;
  }

  try {
    const target = await objectStorageService.getCoverImageUploadTarget(id);
    res.json(RequestArticleCoverUploadUrlResponse.parse(target));
  } catch (error) {
    req.log.error({ err: error }, "Error generating cover image upload URL");
    res.status(500).json({ error: "Failed to generate upload URL" });
  }
});

router.post("/articles/:id/cover-image/verify", requireAuth, async (req, res) => {
  const { id } = req.params;
  const parsed = VerifyArticleCoverUploadBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({
      error: parsed.error.issues[0]?.message ?? "Invalid staged image path",
    });
    return;
  }

  const article = await findEditableOwnedArticle(id, req.user!.id);
  if (article === "not-found") {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (article === "forbidden") {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (article.status === "LETTER") {
    res.status(400).json({ error: "Cannot change cover image of a finalized letter" });
    return;
  }

  try {
    const objectPath = await objectStorageService.verifyAndPublishCoverImage(
      id,
      parsed.data.objectPath,
      MAX_COVER_IMAGE_BYTES,
    );
    res.json(VerifyArticleCoverUploadResponse.parse({
      imageUrl: `/api/storage${objectPath}`,
    }));
  } catch (error) {
    if (error instanceof ObjectNotFoundError) {
      res.status(404).json({ error: "Staged cover image not found" });
      return;
    }
    if (error instanceof InvalidCoverImageError) {
      res.status(400).json({ error: error.message });
      return;
    }
    req.log.error({ err: error }, "Error verifying cover image upload");
    res.status(500).json({ error: "Failed to verify cover image" });
  }
});

router.delete("/articles/:id", requireAuth, async (req, res) => {
  const [existingArticle] = await db
    .select({ id: articlesTable.id, status: articlesTable.status, authorId: articlesTable.authorId })
    .from(articlesTable)
    .where(and(eq(articlesTable.id, req.params.id), visibleArticleStatus, isNull(articlesTable.deletedAt)));

  if (!existingArticle) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (existingArticle.authorId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }

  await db
    .update(articlesTable)
    .set({ deletedAt: new Date() })
    .where(and(eq(articlesTable.id, req.params.id), visibleArticleStatus, isNull(articlesTable.deletedAt)));

  res.status(204).send();
});

router.post("/articles/:id/transition", requireAuth, async (req, res) => {
  const parsed = TransitionArticleStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { targetStatus } = parsed.data;

  const [article] = await db
    .select()
    .from(articlesTable)
    .where(and(eq(articlesTable.id, req.params.id), isNull(articlesTable.deletedAt)));

  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  if (article.authorId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
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

router.post("/articles/:id/finalize", requireAuth, async (req, res) => {
  const parsed = FinalizeArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { myCollectionId } = parsed.data;
  const articleId = req.params.id;

  try {
    const result = await db.transaction(async (tx) => {
      const [article] = await tx.select().from(articlesTable).where(and(eq(articlesTable.id, articleId), visibleArticleStatus, isNull(articlesTable.deletedAt)));
      if (!article) {
        return { status: 404, body: { error: "Article not found" } } as const;
      }
      if (article.authorId !== req.user!.id) {
        return { status: 403, body: { error: "Forbidden" } } as const;
      }

      let updatedArticle = article;
      let didTransitionToLetter = false;
      if (article.status === "CLOSING") {
        const [updated] = await tx
          .update(articlesTable)
          .set({ status: "LETTER", letterAt: new Date() })
          .where(eq(articlesTable.id, articleId))
          .returning();
        updatedArticle = updated;
        didTransitionToLetter = true;
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
        if (collection.ownerId !== req.user!.id) {
          return { status: 403, body: { error: "Forbidden" } } as const;
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

      return { status: 200, body: updatedArticle, didTransitionToLetter } as const;
    });

    res.status(result.status).json(result.body);

    if (result.status === 200 && "didTransitionToLetter" in result && result.didTransitionToLetter) {
      const finalizedArticle = result.body as typeof articlesTable.$inferSelect;
      generateArticleQuestions(finalizedArticle.id, finalizedArticle.content).catch((err) => {
        req.log.error({ err, articleId: finalizedArticle.id }, "Background article question generation failed");
      });
    }
  } catch (error) {
    req.log.error({ err: error }, "Error finalizing article");
    res.status(500).json({ error: "Failed to finalize article" });
  }
});

router.get("/articles/:id/questions", async (req, res) => {
  const articleId = req.params.id;
  const [article] = await db.select({ id: articlesTable.id }).from(articlesTable).where(and(eq(articlesTable.id, articleId), visibleArticleStatus, isNull(articlesTable.deletedAt)));
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  const questions = await getArticleQuestionsOrFallback(articleId);
  res.json({ questions });
});

export default router;
