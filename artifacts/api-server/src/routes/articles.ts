import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, articlesTable, type ArticleStatus } from "@workspace/db";
import { CreateArticleBody, UpdateArticleBody, TransitionArticleStatusBody } from "@workspace/api-zod";

const VALID_TRANSITIONS: Record<string, string> = {
  DRAFT: "DIVIDING",
  DIVIDING: "CLOSING",
  CLOSING: "LETTER",
};

const router: IRouter = Router();

router.get("/articles", async (req, res) => {
  const { authorId, status } = req.query;
  const conditions = [];
  if (authorId) conditions.push(eq(articlesTable.authorId, authorId as string));
  if (status) conditions.push(eq(articlesTable.status, status as ArticleStatus));

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
  if (parsed.data.style !== undefined) updates.style = parsed.data.style;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [article] = await db.update(articlesTable).set(updates).where(eq(articlesTable.id, req.params.id)).returning();
  res.json(article);
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

  const expectedTarget = VALID_TRANSITIONS[article.status];
  if (!expectedTarget || expectedTarget !== targetStatus) {
    res.status(400).json({
      error: `Invalid transition: ${article.status} → ${targetStatus}. Only forward transitions are allowed.`,
    });
    return;
  }

  if (targetStatus === "DIVIDING" && (!article.content || article.content.trim() === "")) {
    res.status(400).json({ error: "Cannot transition to DIVIDING: content is empty" });
    return;
  }

  const updates: Record<string, unknown> = { status: targetStatus };
  if (targetStatus === "CLOSING") {
    if (!article.pages || !Array.isArray(article.pages) || (article.pages as string[]).length === 0) {
      const content = article.content || "";
      const pageTexts = content.split("---").map((p: string) => p.trim()).filter((p: string) => p.length > 0);
      updates.pages = pageTexts.length > 0 ? pageTexts : [content];
    }
  }
  if (targetStatus === "LETTER") {
    updates.letterAt = new Date();
  }

  const [updated] = await db.update(articlesTable).set(updates).where(eq(articlesTable.id, req.params.id)).returning();
  res.json(updated);
});

export default router;
