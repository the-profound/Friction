import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const routesRoot = __dirname;
const readArticlesRoute = () =>
  readFileSync(join(routesRoot, "articles.ts"), "utf8");
const readThoughtsRoute = () =>
  readFileSync(join(routesRoot, "thoughts.ts"), "utf8");

describe("review article reverse-promotion contract", () => {
  it("serializes retries and restores the original thought in one transaction", () => {
    const source = readArticlesRoute();
    const handler = source.slice(
      source.indexOf('router.post("/articles/:id/revert-to-thought"'),
      source.indexOf('router.post("/articles/:id/cover-image"'),
    );

    expect(handler).toContain("db.transaction(async (tx)");
    expect(handler).toContain("pg_advisory_xact_lock");
    expect(handler).toContain('.for("update")');
    expect(handler).toContain('article.status !== "DIVIDING"');
    expect(handler).toContain('eq(thoughtPromotionsTable.promotionType, "promote")');
    expect(handler).toContain("promotions.length !== 1");
    expect(handler).toContain("Another active thought already uses this source article");
    expect(handler).toContain("formatThoughtMarkdown(article.title, article.content)");
    expect(handler).toContain('eq(articlesTable.status, "DIVIDING")');
    expect(handler).toContain('status: "PRELIMINARY"');
    expect(handler).toContain("migratedFromArticleId: articleId");
    expect(handler).toContain(".delete(thoughtPromotionsTable)");
    expect(handler).toContain(".update(articlesTable)");
    expect(handler).toContain("deletedAt: now");
    expect(handler).toContain("throw new ArticleMutationConflictError()");
    expect(handler).toContain('getPostgresErrorCode(error) === "23505"');
    expect(handler).toContain('getPostgresErrorCode(error) === "23503"');
  });

  it("returns the same restored thought after response loss and blocks stale old retries", () => {
    const source = readArticlesRoute();
    const handler = source.slice(
      source.indexOf('router.post("/articles/:id/revert-to-thought"'),
      source.indexOf('router.post("/articles/:id/cover-image"'),
    );

    expect(handler).toContain("if (article.deletedAt)");
    expect(handler).toContain("eq(thoughtsTable.migratedFromArticleId, articleId)");
    expect(handler).toContain("activePromotion");
    expect(handler).toContain("Thought has already been promoted again");
    expect(handler).toContain("return { status: 200, body: restoredThought }");
  });

  it("clears the completed-revert marker when the thought is promoted again", () => {
    const source = readThoughtsRoute();
    const promoteHandler = source.slice(
      source.indexOf('router.post("/thoughts/:id/promote"'),
      source.indexOf('router.delete("/thoughts/:id"'),
    );

    expect(promoteHandler).toContain("pg_advisory_xact_lock");
    expect(promoteHandler).toContain('.for("update")');
    expect(promoteHandler).toContain("migratedFromArticleId: null");
  });

  it("makes ordinary article writes and status transitions lose safely to a completed revert", () => {
    const source = readArticlesRoute();
    const patchHandler = source.slice(
      source.indexOf('router.patch("/articles/:id"'),
      source.indexOf('router.post("/articles/:id/revert-to-thought"'),
    );
    const transitionHandler = source.slice(
      source.indexOf('router.post("/articles/:id/transition"'),
      source.indexOf('router.post("/articles/:id/finalize"'),
    );

    expect(patchHandler).toContain("eq(articlesTable.status, existing.status)");
    expect(patchHandler).toContain("isNull(articlesTable.deletedAt)");
    expect(patchHandler).toContain("throw new ArticleMutationConflictError()");
    expect(transitionHandler).toContain("eq(articlesTable.status, article.status)");
    expect(transitionHandler).toContain("isNull(articlesTable.deletedAt)");
    expect(transitionHandler).toContain("Article changed before the transition completed");
  });

  it("rejects empty review payloads before they can erase a titled article", () => {
    const source = readArticlesRoute();
    const patchHandler = source.slice(
      source.indexOf('router.patch("/articles/:id"'),
      source.indexOf('router.post("/articles/:id/revert-to-thought"'),
    );

    expect(patchHandler).toContain('existing.status === "DIVIDING"');
    expect(patchHandler).toContain('parsed.data.content.trim() === ""');
    expect(patchHandler).toContain(
      "A titled review article cannot be updated with an empty body",
    );
    expect(patchHandler).not.toContain("parsed.data.pages.every");
  });

  it("uses the exact server body as a lossless optimistic concurrency condition", () => {
    const source = readArticlesRoute();
    const patchHandler = source.slice(
      source.indexOf('router.patch("/articles/:id"'),
      source.indexOf('router.post("/articles/:id/revert-to-thought"'),
    );

    expect(patchHandler).toContain("parsed.data.expectedContent !== undefined");
    expect(patchHandler).toContain(
      "eq(articlesTable.content, parsed.data.expectedContent)",
    );
    expect(patchHandler).toContain("throw new ArticleMutationConflictError()");
  });

  it("keeps thought edits and deletes conditional on the reverse-promotion marker", () => {
    const source = readThoughtsRoute();
    const patchHandler = source.slice(
      source.indexOf('router.patch("/thoughts/:id"'),
      source.indexOf('router.post("/thoughts/:id/promote"'),
    );
    const deleteHandler = source.slice(
      source.indexOf('router.delete("/thoughts/:id"'),
      source.indexOf("function isNoteObject"),
    );

    expect(patchHandler).toContain("existing.migratedFromArticleId");
    expect(patchHandler).toContain("pg_advisory_xact_lock");
    expect(patchHandler).toContain("A promoted thought must be edited through its review article");
    expect(patchHandler).toContain("Thought changed while it was being updated");
    expect(deleteHandler).toContain('.for("update")');
    expect(deleteHandler).toContain("pg_advisory_xact_lock");
    expect(deleteHandler).toContain("A promoted thought must be deleted through its review article");
    expect(deleteHandler).toContain("existing.migratedFromArticleId");
    expect(deleteHandler).toContain("Thought changed before it could be deleted");
  });
});