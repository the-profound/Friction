import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, exists, ilike, isNotNull, isNull, ne, notExists, or, sql } from "drizzle-orm";
import { db, articlesTable, myCollectionArticlesTable, myCollectionsTable, thoughtPromotionsTable, thoughtsTable, usersTable, type ArticleStatus } from "@workspace/db";
import { CreateArticleBody, UpdateArticleBody, TransitionArticleStatusBody, FinalizeArticleBody, ReadingMemoQueryParams } from "@workspace/api-zod";
import { ObjectStorageService } from "../lib/objectStorage";
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

function splitThoughtMarkdown(markdown: string | null): { title: string; content: string } {
  const value = markdown ?? "";
  const firstLineEnd = value.indexOf("\n");
  const firstLine = (firstLineEnd < 0 ? value : value.slice(0, firstLineEnd)).replace(/\r$/, "");
  const match = /^#(?!#)\s+(.+?)\s*$/.exec(firstLine.trim());
  if (!match) return { title: "", content: value };

  return {
    title: match[1].trim(),
    content: firstLineEnd < 0 ? "" : value.slice(firstLineEnd + 1).replace(/^\s*\n/, ""),
  };
}

function toThoughtMarkdown(title: string, content: string): string {
  const trimmedTitle = title.trim();
  return trimmedTitle ? `# ${trimmedTitle}\n\n${content}` : content;
}

function preliminaryThoughtAsDraft(thought: typeof thoughtsTable.$inferSelect, id = thought.id) {
  return {
    id,
    authorId: thought.authorId,
    // A thought owns one Markdown document.  Do not split its leading H1 into
    // the article title until the atomic promotion transaction runs.
    title: "",
    content: thought.content ?? "",
    status: "DRAFT" as const,
    pages: null,
    layoutWidth: null,
    style: null,
    cover: null,
    letterAt: null,
    sourceArticleId: thought.sourceArticleId,
    createdAt: thought.createdAt,
    updatedAt: thought.updatedAt,
  };
}

function unpromotedThoughtCondition() {
  return or(
    eq(thoughtsTable.status, "PRELIMINARY"),
    and(
      eq(thoughtsTable.status, "NORMAL"),
      eq(thoughtsTable.createdFrom, "question"),
      notExists(
        db
          .select({ id: thoughtPromotionsTable.id })
          .from(thoughtPromotionsTable)
          .where(eq(thoughtPromotionsTable.fromThoughtId, thoughtsTable.id)),
      ),
    ),
    and(
      isNotNull(thoughtsTable.migratedFromArticleId),
      exists(
        db
          .select({ id: articlesTable.id })
          .from(articlesTable)
          .where(
            and(
              eq(articlesTable.id, thoughtsTable.migratedFromArticleId),
              eq(articlesTable.status, "DRAFT"),
              isNull(articlesTable.deletedAt),
            ),
          ),
      ),
    ),
  );
}

function canAccessPreliminaryThought(
  req: Request,
  res: Response,
  thought: typeof thoughtsTable.$inferSelect,
): boolean {
  if (!req.user) {
    res.status(401).json({ error: "Authentication required" });
    return false;
  }
  if (req.user.id !== thought.authorId) {
    res.status(403).json({ error: "Forbidden" });
    return false;
  }
  return true;
}

router.get("/articles/reading-memo", requireAuth, async (req, res) => {
  const parsed = ReadingMemoQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { sourceArticleId } = parsed.data;
  const userId = req.user!.id;

  const [existingMemo] = await db
    .select()
    .from(thoughtsTable)
    .where(
      and(
        eq(thoughtsTable.authorId, userId),
        eq(thoughtsTable.sourceArticleId, sourceArticleId),
        unpromotedThoughtCondition(),
        isNull(thoughtsTable.deletedAt),
      ),
    )
    .orderBy(sql`${thoughtsTable.updatedAt} DESC`)
    .limit(1);

  if (!existingMemo) {
    res.status(404).json({ error: "Reading memo not found" });
    return;
  }
  res.json(preliminaryThoughtAsDraft(existingMemo, existingMemo.migratedFromArticleId ?? existingMemo.id));
});

router.get("/articles", requireAuth, async (req, res) => {
  const { authorId, status, titleQuery } = req.query;
  const conditions = [];
  if (authorId) conditions.push(eq(articlesTable.authorId, authorId as string));
  if (status) {
    if (status !== "DRAFT") {
      conditions.push(eq(articlesTable.status, status as ArticleStatus));
    }
  } else {
    // DRAFT records were migrated to thoughts. Hiding any surviving legacy
    // rows prevents a memo from appearing twice during the rollout.
    conditions.push(ne(articlesTable.status, "DRAFT"));
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

  const preliminaryThoughts = req.user?.id === authorId
    ? await db
    .select()
    .from(thoughtsTable)
    .where(
      and(
        ...(authorId ? [eq(thoughtsTable.authorId, authorId as string)] : []),
        unpromotedThoughtCondition(),
        isNull(thoughtsTable.deletedAt),
      ),
    )
    : [];

  const drafts = preliminaryThoughts
    .map((thought) => preliminaryThoughtAsDraft(thought, thought.migratedFromArticleId ?? thought.id))
    .filter((draft) => !titleQuery || draft.title.toLowerCase().includes(String(titleQuery).toLowerCase()));

  res.json(status === "DRAFT" ? drafts : [...articles, ...drafts]);
});

router.post("/articles", requireAuth, async (req, res) => {
  const parsed = CreateArticleBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { content, sourceArticleId } = parsed.data;
  const authorId = req.user!.id;
  let { title } = parsed.data;

  if (sourceArticleId) {
    const [sourceArticle] = await db
      .select({ title: articlesTable.title })
      .from(articlesTable)
      .where(eq(articlesTable.id, sourceArticleId));
    if (sourceArticle && (title.trim() === "" || title.trim() === "읽기 메모")) {
      title = `읽기 메모 — ${sourceArticle.title}`;
    }
  }

  const thought = await db.transaction(async (tx) => {
    if (sourceArticleId) {
      await tx
        .update(articlesTable)
        .set({ sourceArticleId: null })
        .where(
          and(
            eq(articlesTable.authorId, authorId),
            eq(articlesTable.sourceArticleId, sourceArticleId),
          ),
        );
      await tx
        .update(thoughtsTable)
        .set({ sourceArticleId: null })
        .where(
          and(
            eq(thoughtsTable.authorId, authorId),
            eq(thoughtsTable.sourceArticleId, sourceArticleId),
          ),
        );
    }

    const [created] = await tx
      .insert(thoughtsTable)
      .values({
        authorId,
        content: toThoughtMarkdown(title, content ?? ""),
        sourceArticleId: sourceArticleId ?? null,
        createdFrom: sourceArticleId ? "reading" : "direct",
        status: "PRELIMINARY",
      })
      .returning();
    return created;
  });

  res.status(201).json(preliminaryThoughtAsDraft(thought));
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
    .where(eq(articlesTable.id, req.params.id));
  if (row) {
    if (row.article.status === "DRAFT") {
      const [migrated] = await db.select().from(thoughtsTable)
      .where(and(
        eq(thoughtsTable.migratedFromArticleId, row.article.id),
        isNull(thoughtsTable.deletedAt),
      )).limit(1);
      if (migrated) {
        if (!canAccessPreliminaryThought(req, res, migrated)) return;
        res.json(preliminaryThoughtAsDraft(migrated, row.article.id));
        return;
      }
    }
    res.json({
      ...row.article,
      authorNickname: row.authorNickname ?? null,
      collectionName: row.collectionName ?? null,
      collectionId: row.collectionId ?? null,
    });
    return;
  }

  const [thought] = await db
    .select()
    .from(thoughtsTable)
    .where(
      and(
        eq(thoughtsTable.id, req.params.id),
        unpromotedThoughtCondition(),
        isNull(thoughtsTable.deletedAt),
      ),
    );
  if (!thought) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (!canAccessPreliminaryThought(req, res, thought)) return;
  res.json(preliminaryThoughtAsDraft(thought));
});

router.patch("/articles/:id", requireAuth, async (req, res) => {
  const [existing] = await db.select().from(articlesTable).where(and(eq(articlesTable.id, req.params.id), isNull(articlesTable.deletedAt)));
  if (!existing) {
    const [thought] = await db
      .select()
      .from(thoughtsTable)
      .where(
        and(
          eq(thoughtsTable.id, req.params.id),
          unpromotedThoughtCondition(),
          isNull(thoughtsTable.deletedAt),
        ),
      );
    if (!thought) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    if (!canAccessPreliminaryThought(req, res, thought)) return;

    const parsed = UpdateArticleBody.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
      return;
    }
    if (
      parsed.data.pages !== undefined ||
      parsed.data.layoutWidth !== undefined ||
      parsed.data.style !== undefined ||
      parsed.data.cover !== undefined
    ) {
      res.status(400).json({ error: "Formatting data can only be set after promotion to DIVIDING" });
      return;
    }

    const sourceArticleId = "sourceArticleId" in parsed.data
      ? parsed.data.sourceArticleId
      : thought.sourceArticleId;
    const [updated] = await db
      .update(thoughtsTable)
      .set({
        // Thought-mode editors own one canonical Markdown document, including
        // its leading H1.  Article facades expose an empty title, so rebuilding
        // with `toThoughtMarkdown` would add a second heading on every save.
        content: parsed.data.content ?? thought.content,
        sourceArticleId,
        updatedAt: new Date(),
      })
      .where(eq(thoughtsTable.id, thought.id))
      .returning();
    res.json(preliminaryThoughtAsDraft(updated));
    return;
  }
  if (existing.status === "DRAFT") {
    const [migratedThought] = await db
      .select()
      .from(thoughtsTable)
      .where(and(
        eq(thoughtsTable.migratedFromArticleId, existing.id),
        isNull(thoughtsTable.deletedAt),
      ))
      .limit(1);
    if (migratedThought) {
      if (!canAccessPreliminaryThought(req, res, migratedThought)) return;
      const parsed = UpdateArticleBody.safeParse(req.body);
      if (!parsed.success) {
        res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
        return;
      }
      const [updated] = await db.update(thoughtsTable).set({
        // Migrated DRAFT facades use the same canonical Markdown document
        // contract as newly created thoughts.
        content: parsed.data.content ?? migratedThought.content,
        updatedAt: new Date(),
      }).where(eq(thoughtsTable.id, migratedThought.id)).returning();
      res.json(preliminaryThoughtAsDraft(updated, existing.id));
      return;
    }
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
            ne(articlesTable.id, req.params.id),
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

  const [article] = await db.select().from(articlesTable).where(and(eq(articlesTable.id, id), isNull(articlesTable.deletedAt)));
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }
  if (article.authorId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
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

router.delete("/articles/:id", requireAuth, async (req, res) => {
  const [existingArticle] = await db
    .select({ id: articlesTable.id, status: articlesTable.status, authorId: articlesTable.authorId })
    .from(articlesTable)
    .where(and(eq(articlesTable.id, req.params.id), isNull(articlesTable.deletedAt)));
  if (existingArticle && existingArticle.authorId !== req.user!.id) {
    res.status(403).json({ error: "Forbidden" });
    return;
  }
  if (existingArticle?.status === "DRAFT") {
    const [migratedThought] = await db
      .select({ id: thoughtsTable.id })
      .from(thoughtsTable)
      .where(and(
        eq(thoughtsTable.migratedFromArticleId, existingArticle.id),
        isNull(thoughtsTable.deletedAt),
      ))
      .limit(1);
    if (migratedThought) {
      await db.transaction(async (tx) => {
        const deletedAt = new Date();
        await tx
          .update(thoughtsTable)
          .set({ deletedAt })
          .where(eq(thoughtsTable.id, migratedThought.id));
        await tx
          .update(articlesTable)
          .set({ deletedAt })
          .where(and(eq(articlesTable.id, existingArticle.id), eq(articlesTable.status, "DRAFT")));
      });
      res.status(204).send();
      return;
    }
  }

  const [updated] = await db
    .update(articlesTable)
    .set({ deletedAt: new Date() })
    .where(and(eq(articlesTable.id, req.params.id), isNull(articlesTable.deletedAt)))
    .returning({ id: articlesTable.id });
  if (!updated) {
    const [thought] = await db
      .select()
      .from(thoughtsTable)
      .where(
        and(
          eq(thoughtsTable.id, req.params.id),
          unpromotedThoughtCondition(),
          isNull(thoughtsTable.deletedAt),
        ),
      );
    if (!thought) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    if (!canAccessPreliminaryThought(req, res, thought)) return;

    await db
      .update(thoughtsTable)
      .set({ deletedAt: new Date() })
      .where(eq(thoughtsTable.id, thought.id));
  }
  res.status(204).send();
});

router.post("/articles/:id/transition", requireAuth, async (req, res) => {
  const parsed = TransitionArticleStatusBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { targetStatus } = parsed.data;

  const [article] = await db.select().from(articlesTable).where(and(eq(articlesTable.id, req.params.id), isNull(articlesTable.deletedAt)));
  if (!article) {
    const [thought] = await db
      .select()
      .from(thoughtsTable)
      .where(
        and(
          eq(thoughtsTable.id, req.params.id),
          unpromotedThoughtCondition(),
          isNull(thoughtsTable.deletedAt),
        ),
      );
    if (!thought) {
      res.status(404).json({ error: "Article not found" });
      return;
    }
    if (!canAccessPreliminaryThought(req, res, thought)) return;
    if (targetStatus !== "DIVIDING") {
      res.status(400).json({ error: "A preliminary thought can only be promoted to DIVIDING" });
      return;
    }

    const { title, content } = splitThoughtMarkdown(thought.content);
    if (!title || !content.trim()) {
      res.status(400).json({ error: "Thought must start with a non-empty H1 title and contain a non-empty body" });
      return;
    }

    try {
      const promoted = await db.transaction(async (tx) => {
        const [existingPromotion] = await tx
          .select({ id: thoughtsTable.id })
          .from(thoughtsTable)
          .where(and(eq(thoughtsTable.id, thought.id), unpromotedThoughtCondition()))
          .limit(1);
        if (!existingPromotion) return null;

        const [created] = await tx
          .insert(articlesTable)
          .values({
            id: thought.id,
            authorId: thought.authorId,
            title,
            content,
            status: "DIVIDING",
            sourceArticleId: thought.sourceArticleId,
          })
          .returning();

        await tx
          .insert(thoughtPromotionsTable)
          .values({ fromThoughtId: thought.id, toDraftId: created.id, promotionType: "promote" });
        await tx
          .update(thoughtsTable)
          .set({ status: "NORMAL", updatedAt: new Date() })
          .where(eq(thoughtsTable.id, thought.id));
        return created;
      });
      if (!promoted) {
        res.status(409).json({ error: "Thought has already been promoted" });
        return;
      }
      res.json(promoted);
      return;
    } catch (error) {
      if ((error as { cause?: { code?: string } }).cause?.code === "23505") {
        res.status(409).json({ error: "Thought has already been promoted" });
        return;
      }
      req.log.error({ err: error, thoughtId: thought.id }, "Error promoting preliminary thought");
      res.status(500).json({ error: "Failed to promote thought" });
      return;
    }
  }

  if (article.status === "DRAFT") {
    const [migratedThought] = await db
      .select()
      .from(thoughtsTable)
      .where(and(
        eq(thoughtsTable.migratedFromArticleId, article.id),
        isNull(thoughtsTable.deletedAt),
      ))
      .limit(1);
    if (migratedThought) {
      if (!canAccessPreliminaryThought(req, res, migratedThought)) return;
      if (targetStatus !== "DIVIDING") {
        res.status(400).json({ error: "A migrated draft can only be promoted to DIVIDING" });
        return;
      }
      const { title, content } = splitThoughtMarkdown(migratedThought.content);
      if (!title || !content.trim()) {
        res.status(400).json({ error: "Thought must start with a non-empty H1 title and contain a non-empty body" });
        return;
      }
      const promoted = await db.transaction(async (tx) => {
        const [existingPromotion] = await tx
          .select({ id: thoughtPromotionsTable.id })
          .from(thoughtPromotionsTable)
          .where(eq(thoughtPromotionsTable.fromThoughtId, migratedThought.id))
          .limit(1);
        if (existingPromotion) return null;
        const [updated] = await tx
          .update(articlesTable)
          .set({ title, content, status: "DIVIDING" })
          .where(and(eq(articlesTable.id, article.id), eq(articlesTable.status, "DRAFT")))
          .returning();
        if (!updated) return null;
        await tx.insert(thoughtPromotionsTable).values({
          fromThoughtId: migratedThought.id,
          toDraftId: updated.id,
          promotionType: "promote",
        });
        return updated;
      });
      if (!promoted) {
        res.status(409).json({ error: "Thought has already been promoted" });
        return;
      }
      res.json(promoted);
      return;
    }
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

  if (article.status === "DIVIDING" && targetStatus === "DRAFT") {
    res.status(400).json({ error: "DIVIDING articles cannot be moved back to a thought" });
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
      const [article] = await tx.select().from(articlesTable).where(and(eq(articlesTable.id, articleId), isNull(articlesTable.deletedAt)));
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
  const [article] = await db.select({ id: articlesTable.id }).from(articlesTable).where(and(eq(articlesTable.id, articleId), isNull(articlesTable.deletedAt)));
  if (!article) {
    res.status(404).json({ error: "Article not found" });
    return;
  }

  const questions = await getArticleQuestionsOrFallback(articleId);
  res.json({ questions });
});

export default router;
