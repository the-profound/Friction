import { Router, type IRouter } from "express";
import { and, eq, ilike, isNotNull, isNull, ne, or, sql } from "drizzle-orm";
import {
  db,
  articlesTable,
  myCollectionArticlesTable,
  myCollectionsTable,
  thoughtPromotionsTable,
  thoughtsTable,
  usersTable,
  type ArticleStatus,
} from "@workspace/db";
import {
  UpdateArticleBody,
  CloseArticleBody,
  TransitionArticleStatusBody,
  FinalizeArticleBody,
  RequestArticleCoverUploadUrlBody,
  RequestArticleCoverUploadUrlResponse,
  RevertArticleToThoughtBody,
  VerifyArticleCoverUploadBody,
  VerifyArticleCoverUploadResponse,
  isMeaningfulThoughtMarkdown,
} from "@workspace/api-zod";
import {
  InvalidCoverImageError,
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";
import {
  generateArticleQuestions,
  getArticleQuestionsOrFallback,
} from "../services/generate-article-questions";
import { requireAuth } from "../middlewares/requireAuth";
import { formatThoughtMarkdown, validateTransitionSnapshot } from "./thoughts";

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

class ArticleMutationConflictError extends Error {}

function getPostgresErrorCode(error: unknown): string | undefined {
  return (error as { cause?: { code?: string } })?.cause?.code;
}

async function findEditableOwnedArticle(
  articleId: string,
  userId: string,
): Promise<{ status: string } | "not-found" | "forbidden"> {
  const [article] = await db
    .select()
    .from(articlesTable)
    .where(
      and(
        eq(articlesTable.id, articleId),
        visibleArticleStatus,
        isNull(articlesTable.deletedAt),
      ),
    );
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
  if (titleQuery)
    conditions.push(ilike(articlesTable.title, `%${titleQuery as string}%`));

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
    .where(
      and(
        eq(articlesTable.id, req.params.id),
        visibleArticleStatus,
        isNull(articlesTable.deletedAt),
      ),
    );

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
    .where(
      and(
        eq(articlesTable.id, req.params.id),
        visibleArticleStatus,
        isNull(articlesTable.deletedAt),
      ),
    );

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
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const nextTitle = parsed.data.title ?? existing.title;
  if (
    existing.status === "DIVIDING" &&
    parsed.data.content !== undefined &&
    nextTitle.trim() !== "" &&
    parsed.data.content.trim() === ""
  ) {
    res.status(400).json({
      error: "A titled review article cannot be updated with an empty body",
    });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (parsed.data.title !== undefined) updates.title = parsed.data.title;
  if (parsed.data.content !== undefined) {
    updates.content = parsed.data.content;
    req.log.info(
      {
        articleId: req.params.id,
        contentLen: (parsed.data.content ?? "").length,
        contentPreview: (parsed.data.content ?? "").slice(0, 80),
      },
      "PATCH content payload",
    );
  }
  if (parsed.data.pages !== undefined) updates.pages = parsed.data.pages;
  if (parsed.data.layoutWidth !== undefined)
    updates.layoutWidth = parsed.data.layoutWidth;
  if (parsed.data.style !== undefined) updates.style = parsed.data.style;
  if (parsed.data.cover !== undefined) updates.cover = parsed.data.cover;
  if ("sourceArticleId" in parsed.data)
    updates.sourceArticleId = parsed.data.sourceArticleId;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const newSourceArticleId = updates.sourceArticleId as
    | string
    | null
    | undefined;
  try {
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
      const [updated] = await tx
        .update(articlesTable)
        .set(updates)
        .where(
          and(
            eq(articlesTable.id, req.params.id),
            eq(articlesTable.status, existing.status),
            ...(parsed.data.expectedContent !== undefined
              ? [eq(articlesTable.content, parsed.data.expectedContent)]
              : []),
            isNull(articlesTable.deletedAt),
          ),
        )
        .returning();
      if (!updated) throw new ArticleMutationConflictError();
      return updated;
    });
    res.json(article);
  } catch (error) {
    if (error instanceof ArticleMutationConflictError) {
      res.status(409).json({
        error: "Article changed while it was being updated. Please retry.",
      });
      return;
    }
    throw error;
  }
});

router.post(
  "/articles/:id/revert-to-thought",
  requireAuth,
  async (req, res) => {
    const articleId = req.params.id;
    const userId = req.user!.id;
    const parsedBody = RevertArticleToThoughtBody.safeParse(req.body ?? {});
    if (!parsedBody.success) {
      res.status(400).json({
        error: parsedBody.error.issues[0]?.message ?? "Validation error",
        code: "INVALID_SNAPSHOT",
      });
      return;
    }
    const snapshotResult = validateTransitionSnapshot(parsedBody.data);
    if (snapshotResult && "error" in snapshotResult) {
      res.status(400).json(snapshotResult);
      return;
    }
    const snapshot = snapshotResult?.snapshot ?? null;

    try {
      const result = await db.transaction(async (tx) => {
        // A response-loss retry and a rapid double tap must observe one completed
        // transition, never two partially-applied copies.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`article-revert-to-thought:${articleId}`}))`,
        );

        const [article] = await tx
          .select()
          .from(articlesTable)
          .where(eq(articlesTable.id, articleId))
          .limit(1)
          .for("update");
        if (!article)
          return { status: 404, body: { error: "Article not found" } } as const;
        if (article.authorId !== userId) {
          return { status: 403, body: { error: "Forbidden" } } as const;
        }

        if (article.deletedAt) {
          const [restoredThoughtCandidate] = await tx
            .select()
            .from(thoughtsTable)
            .where(
              and(
                eq(thoughtsTable.authorId, userId),
                eq(thoughtsTable.migratedFromArticleId, articleId),
                isNull(thoughtsTable.deletedAt),
              ),
            )
            .limit(1);
          if (!restoredThoughtCandidate) {
            return {
              status: 409,
              body: {
                error: "Article is no longer the current review for a thought",
              },
            } as const;
          }

          await tx.execute(
            sql`SELECT pg_advisory_xact_lock(hashtext(${`thought-promotion:${restoredThoughtCandidate.id}`}))`,
          );
          const [restoredThought] = await tx
            .select()
            .from(thoughtsTable)
            .where(
              and(
                eq(thoughtsTable.id, restoredThoughtCandidate.id),
                eq(thoughtsTable.authorId, userId),
                eq(thoughtsTable.migratedFromArticleId, articleId),
                isNull(thoughtsTable.deletedAt),
              ),
            )
            .limit(1)
            .for("update");
          if (!restoredThought) {
            return {
              status: 409,
              body: {
                error: "Article is no longer the current review for a thought",
              },
            } as const;
          }

          const [activePromotion] = await tx
            .select({ id: thoughtPromotionsTable.id })
            .from(thoughtPromotionsTable)
            .where(
              and(
                eq(thoughtPromotionsTable.fromThoughtId, restoredThought.id),
                eq(thoughtPromotionsTable.promotionType, "promote"),
              ),
            )
            .limit(1);
          if (activePromotion) {
            return {
              status: 409,
              body: { error: "Thought has already been promoted again" },
            } as const;
          }
          return { status: 200, body: restoredThought } as const;
        }

        if (article.status !== "DIVIDING") {
          return {
            status: 409,
            body: {
              error: `Only DIVIDING articles can return to a thought; current status is ${article.status}`,
            },
          } as const;
        }

        if (
          snapshot &&
          snapshot.expectedUpdatedAt.getTime() !== article.updatedAt.getTime()
        ) {
          return {
            status: 409,
            body: {
              error:
                "Snapshot is older than the current review article; refresh before returning",
              code: "STALE_SNAPSHOT",
            },
          } as const;
        }

        const promotions = await tx
          .select({
            id: thoughtPromotionsTable.id,
            thoughtId: thoughtPromotionsTable.fromThoughtId,
            promotionType: thoughtPromotionsTable.promotionType,
          })
          .from(thoughtPromotionsTable)
          .where(
            and(
              eq(thoughtPromotionsTable.toDraftId, articleId),
              eq(thoughtPromotionsTable.promotionType, "promote"),
            ),
          )
          .limit(2);
        if (promotions.length !== 1) {
          return {
            status: 409,
            body: {
              error:
                promotions.length === 0
                  ? "Article is not linked to an original promoted thought"
                  : "Article has conflicting promotion links",
            },
          } as const;
        }
        const promotion = promotions[0];

        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${`thought-promotion:${promotion.thoughtId}`}))`,
        );
        const [thought] = await tx
          .select()
          .from(thoughtsTable)
          .where(
            and(
              eq(thoughtsTable.id, promotion.thoughtId),
              eq(thoughtsTable.authorId, userId),
              isNull(thoughtsTable.deletedAt),
            ),
          )
          .limit(1)
          .for("update");
        if (!thought) {
          return {
            status: 409,
            body: { error: "Original thought is unavailable" },
          } as const;
        }

        if (thought.sourceArticleId) {
          const [sourceConflict] = await tx
            .select({ id: thoughtsTable.id })
            .from(thoughtsTable)
            .where(
              and(
                eq(thoughtsTable.authorId, userId),
                eq(thoughtsTable.sourceArticleId, thought.sourceArticleId),
                ne(thoughtsTable.id, thought.id),
                isNull(thoughtsTable.deletedAt),
                isNotNull(thoughtsTable.migratedFromArticleId),
              ),
            )
            .limit(1);
          if (sourceConflict) {
            return {
              status: 409,
              body: {
                error:
                  "Another restored thought already uses this source article",
              },
            } as const;
          }
        }

        const title = snapshot?.title ?? article.title;
        const content = snapshot?.content ?? article.content;
        const titleLines = title.replace(/\r\n?/g, "\n").split("\n");
        if (!title.trim() || titleLines.some((line) => line.trim() === "")) {
          return {
            status: 400,
            body: {
              error:
                "Article title must not be empty or contain an empty line when returning to a thought",
              code: "INVALID_SNAPSHOT",
            },
          } as const;
        }
        if (
          !isMeaningfulThoughtMarkdown(formatThoughtMarkdown(title, content))
        ) {
          return {
            status: 400,
            body: {
              error:
                "Article body must include text or an image when returning to a thought",
              code: "INVALID_SNAPSHOT",
            },
          } as const;
        }

        const thoughtMarkdown = snapshot
          ? formatThoughtMarkdown(title, content)
          : formatThoughtMarkdown(article.title, article.content);
        const now = new Date();
        const [revertedArticle] = await tx
          .update(articlesTable)
          .set({ title, content, deletedAt: now, updatedAt: now })
          .where(
            and(
              eq(articlesTable.id, articleId),
              eq(articlesTable.status, "DIVIDING"),
              isNull(articlesTable.deletedAt),
            ),
          )
          .returning({ id: articlesTable.id });
        if (!revertedArticle) throw new ArticleMutationConflictError();

        const [restoredThought] = await tx
          .update(thoughtsTable)
          .set({
            content: thoughtMarkdown,
            status: "NORMAL",
            migratedFromArticleId: articleId,
            updatedAt: now,
          })
          .where(
            and(
              eq(thoughtsTable.id, thought.id),
              eq(thoughtsTable.authorId, userId),
              isNull(thoughtsTable.deletedAt),
              eq(thoughtsTable.status, thought.status),
              isNull(thoughtsTable.migratedFromArticleId),
            ),
          )
          .returning();
        if (!restoredThought) throw new ArticleMutationConflictError();

        const deletedPromotion = await tx
          .delete(thoughtPromotionsTable)
          .where(
            and(
              eq(thoughtPromotionsTable.id, promotion.id),
              eq(thoughtPromotionsTable.toDraftId, articleId),
              eq(thoughtPromotionsTable.promotionType, "promote"),
            ),
          )
          .returning({ id: thoughtPromotionsTable.id });
        if (deletedPromotion.length !== 1)
          throw new ArticleMutationConflictError();

        return { status: 200, body: restoredThought } as const;
      });

      res.status(result.status).json(result.body);
    } catch (error) {
      if (
        error instanceof ArticleMutationConflictError ||
        getPostgresErrorCode(error) === "23505" ||
        getPostgresErrorCode(error) === "23503"
      ) {
        res.status(409).json({
          error:
            "Article changed before it could return to a thought. Please retry.",
        });
        return;
      }
      req.log.error(
        { err: error, articleId },
        "Error returning review article to thought",
      );
      res.status(500).json({ error: "Failed to return article to thought" });
    }
  },
);

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
    res
      .status(400)
      .json({ error: "Cannot change cover image of a finalized letter" });
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

router.post(
  "/articles/:id/cover-image/verify",
  requireAuth,
  async (req, res) => {
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
      res
        .status(400)
        .json({ error: "Cannot change cover image of a finalized letter" });
      return;
    }

    try {
      const objectPath = await objectStorageService.verifyAndPublishCoverImage(
        id,
        parsed.data.objectPath,
        MAX_COVER_IMAGE_BYTES,
      );
      res.json(
        VerifyArticleCoverUploadResponse.parse({
          imageUrl: `/api/storage${objectPath}`,
        }),
      );
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
  },
);

router.delete("/articles/:id", requireAuth, async (req, res) => {
  const [existingArticle] = await db
    .select({
      id: articlesTable.id,
      status: articlesTable.status,
      authorId: articlesTable.authorId,
    })
    .from(articlesTable)
    .where(
      and(
        eq(articlesTable.id, req.params.id),
        visibleArticleStatus,
        isNull(articlesTable.deletedAt),
      ),
    );

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
    .where(
      and(
        eq(articlesTable.id, req.params.id),
        visibleArticleStatus,
        isNull(articlesTable.deletedAt),
      ),
    );

  res.status(204).send();
});

router.post("/articles/:id/transition", requireAuth, async (req, res) => {
  const parsed = TransitionArticleStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { targetStatus } = parsed.data;

  const [article] = await db
    .select()
    .from(articlesTable)
    .where(
      and(eq(articlesTable.id, req.params.id), isNull(articlesTable.deletedAt)),
    );

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

  if (
    isForward &&
    targetStatus === "DIVIDING" &&
    (!article.content || article.content.trim() === "")
  ) {
    res
      .status(400)
      .json({ error: "Cannot transition to DIVIDING: content is empty" });
    return;
  }

  const updates: Record<string, unknown> = { status: targetStatus };
  if (isForward && targetStatus === "CLOSING") {
    if (
      !article.pages ||
      !Array.isArray(article.pages) ||
      (article.pages as string[]).length === 0
    ) {
      const content = article.content || "";
      const pageTexts = content
        .split("---")
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 0);
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
      .where(
        and(
          eq(articlesTable.id, req.params.id),
          eq(articlesTable.status, article.status),
          isNull(articlesTable.deletedAt),
        ),
      )
      .returning();
    if (!updated) {
      res.status(409).json({
        error: "Article changed before the transition completed. Please retry.",
      });
      return;
    }
    res.json(updated);
    return;
  }

  const [updated] = await db
    .update(articlesTable)
    .set(updates)
    .where(
      and(
        eq(articlesTable.id, req.params.id),
        eq(articlesTable.status, article.status),
        isNull(articlesTable.deletedAt),
      ),
    )
    .returning();
  if (!updated) {
    res.status(409).json({
      error: "Article changed before the transition completed. Please retry.",
    });
    return;
  }
  res.json(updated);
});

router.post("/articles/:id/close", requireAuth, async (req, res) => {
  const parsed = CloseArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }

  const articleId = req.params.id as string;
  const { title, content, pages } = parsed.data;

  try {
    const result = await db.transaction(async (tx) => {
      // Serialize close retries and make competing article transitions observe
      // a completed close. The row lock makes the snapshot comparison and write
      // one atomic decision, so a response-loss retry cannot partially close.
      await tx.execute(
        sql`SELECT pg_advisory_xact_lock(hashtext(${`article-close:${articleId}`}))`,
      );

      const [article] = await tx
        .select()
        .from(articlesTable)
        .where(eq(articlesTable.id, articleId))
        .limit(1)
        .for("update");

      if (!article || article.deletedAt) {
        return { status: 404, body: { error: "Article not found" } } as const;
      }
      if (article.authorId !== req.user!.id) {
        return { status: 403, body: { error: "Forbidden" } } as const;
      }

      const isSameSnapshot =
        article.title === title &&
        article.content === content &&
        Array.isArray(article.pages) &&
        JSON.stringify(article.pages) === JSON.stringify(pages);

      // A retry that arrives after the original response was lost is already
      // complete. Only the exact snapshot is idempotent; never hide a newer
      // conflicting close behind a successful response.
      if (article.status === "CLOSING") {
        if (isSameSnapshot) return { status: 200, body: article } as const;
        return {
          status: 409,
          body: {
            error: "Article is already CLOSING with a different snapshot",
          },
        } as const;
      }

      if (article.status !== "DIVIDING") {
        return {
          status: 400,
          body: {
            error: `Invalid close transition from ${article.status}. Only DIVIDING articles can be closed.`,
          },
        } as const;
      }

      const [closed] = await tx
        .update(articlesTable)
        .set({ title, content, pages, status: "CLOSING" })
        .where(
          and(
            eq(articlesTable.id, articleId),
            eq(articlesTable.status, "DIVIDING"),
            isNull(articlesTable.deletedAt),
          ),
        )
        .returning();

      if (!closed) throw new ArticleMutationConflictError();
      return { status: 200, body: closed } as const;
    });

    res.status(result.status).json(result.body);
  } catch (error) {
    if (error instanceof ArticleMutationConflictError) {
      res.status(409).json({
        error: "Article changed before the close completed. Please retry.",
      });
      return;
    }
    throw error;
  }
});

router.post("/articles/:id/finalize", requireAuth, async (req, res) => {
  const parsed = FinalizeArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { myCollectionId } = parsed.data;
  const articleId = req.params.id;

  try {
    const result = await db.transaction(async (tx) => {
      const [article] = await tx
        .select()
        .from(articlesTable)
        .where(
          and(
            eq(articlesTable.id, articleId),
            visibleArticleStatus,
            isNull(articlesTable.deletedAt),
          ),
        );
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
        const [collection] = await tx
          .select()
          .from(myCollectionsTable)
          .where(eq(myCollectionsTable.id, myCollectionId));
        if (!collection) {
          return {
            status: 404,
            body: { error: "Collection not found" },
          } as const;
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

      return {
        status: 200,
        body: updatedArticle,
        didTransitionToLetter,
      } as const;
    });

    res.status(result.status).json(result.body);

    if (
      result.status === 200 &&
      "didTransitionToLetter" in result &&
      result.didTransitionToLetter
    ) {
      const finalizedArticle = result.body as typeof articlesTable.$inferSelect;
      generateArticleQuestions(
        finalizedArticle.id,
        finalizedArticle.content,
      ).catch((err) => {
        req.log.error(
          { err, articleId: finalizedArticle.id },
          "Background article question generation failed",
        );
      });
    }
  } catch (error) {
    req.log.error({ err: error }, "Error finalizing article");
    res.status(500).json({ error: "Failed to finalize article" });
  }
});

router.get("/articles/:id/questions", async (req, res) => {
  const articleId = req.params.id;
  const [article] = await db
    .select({ id: articlesTable.id })
    .from(articlesTable)
    .where(
      and(
        eq(articlesTable.id, articleId),
        visibleArticleStatus,
        isNull(articlesTable.deletedAt),
      ),
    );
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  const questions = await getArticleQuestionsOrFallback(articleId);
  res.json({ questions });
});

export default router;
