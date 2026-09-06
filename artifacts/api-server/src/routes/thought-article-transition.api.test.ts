import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { PromoteThoughtBody, RevertArticleToThoughtBody } from "@workspace/api-zod";
import {
  canPromoteThoughtToArticle,
  validateTransitionSnapshot,
} from "./thoughts";

const routesRoot = __dirname;
const readRoute = (name: string) => readFileSync(join(routesRoot, name), "utf8");

const validSnapshot = {
  title: "최신 제목",
  content: "응답 유실 전에 입력한 최신 본문",
  expectedUpdatedAt: "2026-09-03T00:00:00.000Z",
  requestId: "7b7d3a84-1af1-4d1e-9c25-4e2a0b5f817a",
};

describe("thought/review atomic transition contract", () => {
  it("allows NORMAL thoughts from every ordinary creation origin", () => {
    expect(
      canPromoteThoughtToArticle({
        status: "NORMAL",
        createdFrom: "reading",
        migratedFromArticleId: null,
      }),
    ).toBe(true);
    expect(
      canPromoteThoughtToArticle({
        status: "NORMAL",
        createdFrom: "quoted",
        migratedFromArticleId: null,
      }),
    ).toBe(true);
    expect(
      canPromoteThoughtToArticle({
        status: "NORMAL",
        createdFrom: "direct",
        migratedFromArticleId: null,
      }),
    ).toBe(true);
  });

  it("blocks every PRELIMINARY thought, including unactivated questions", () => {
    expect(
      canPromoteThoughtToArticle({
        status: "PRELIMINARY",
        createdFrom: "question",
        migratedFromArticleId: null,
      }),
    ).toBe(false);
    expect(
      canPromoteThoughtToArticle({
        status: "PRELIMINARY",
        createdFrom: "direct",
        migratedFromArticleId: "article-before-revert",
      }),
    ).toBe(false);
  });

  it("accepts the same optional snapshot shape for promotion and return", () => {
    expect(PromoteThoughtBody.safeParse(validSnapshot).success).toBe(true);
    expect(RevertArticleToThoughtBody.safeParse(validSnapshot).success).toBe(true);
    expect(PromoteThoughtBody.safeParse({}).success).toBe(true);
    expect(RevertArticleToThoughtBody.safeParse({}).success).toBe(true);
  });

  it("rejects incomplete, empty, and malformed snapshots before a transaction can write", () => {
    expect(
      validateTransitionSnapshot({
        title: validSnapshot.title,
        content: validSnapshot.content,
      }),
    ).toMatchObject({ code: "INVALID_SNAPSHOT" });
    expect(
      validateTransitionSnapshot({
        title: "   ",
        content: validSnapshot.content,
        expectedUpdatedAt: validSnapshot.expectedUpdatedAt,
      }),
    ).toMatchObject({ code: "INVALID_SNAPSHOT" });
    expect(
      validateTransitionSnapshot({
        title: validSnapshot.title,
        content: "",
        expectedUpdatedAt: validSnapshot.expectedUpdatedAt,
      }),
    ).toMatchObject({ code: "INVALID_SNAPSHOT" });
    expect(
      validateTransitionSnapshot({
        title: validSnapshot.title,
        content: validSnapshot.content,
        expectedUpdatedAt: "not-a-date",
      }),
    ).toMatchObject({ code: "INVALID_SNAPSHOT" });
  });

  it("keeps the transition handlers locked and version-checked", () => {
    const thoughtsRoute = readRoute("thoughts.ts");
    const articlesRoute = readRoute("articles.ts");
    const promoteHandler = thoughtsRoute.slice(
      thoughtsRoute.indexOf('router.post("/thoughts/:id/promote"'),
      thoughtsRoute.indexOf('router.delete("/thoughts/:id"'),
    );
    const revertPathIndex = articlesRoute.indexOf('"/articles/:id/revert-to-thought"');
    const revertHandler = articlesRoute.slice(
      articlesRoute.lastIndexOf("router.post(", revertPathIndex),
      articlesRoute.indexOf('"/articles/:id/cover-image"'),
    );

    expect(promoteHandler).toContain("db.transaction(async (tx)");
    expect(promoteHandler).toContain("expectedUpdatedAt.getTime()");
    expect(promoteHandler).toContain("existingPromotion");
    expect(promoteHandler).toContain("canPromoteThoughtToArticle(thought)");
    expect(promoteHandler).toContain("return { status: 200, body: existingArticle }");
    expect(promoteHandler).toContain("snapshot.expectedUpdatedAt.getTime()");
    expect(promoteHandler).toContain("formatThoughtMarkdown(snapshot.title, snapshot.content)");
    expect(promoteHandler).toContain("promotionType: \"promote\"");
    expect(promoteHandler).toContain('status: "NORMAL"');
    expect(revertHandler).toContain("db.transaction(async (tx)");
    expect(revertHandler).toContain("expectedUpdatedAt.getTime()");
    expect(revertHandler).toContain("set({ title, content, deletedAt: now, updatedAt: now })");
    expect(revertHandler).toContain('status: "NORMAL"');
    expect(revertHandler).toContain("return { status: 200, body: restoredThought }");
  });
});