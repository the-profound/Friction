import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  articlesTable,
  db,
  thoughtPromotionsTable,
  thoughtsTable,
  usersTable,
} from "@workspace/db";

const createdArticleIds: string[] = [];
const createdThoughtIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
  for (const thoughtId of createdThoughtIds) {
    await db
      .delete(thoughtPromotionsTable)
      .where(eq(thoughtPromotionsTable.fromThoughtId, thoughtId));
  }
  for (const articleId of createdArticleIds) {
    await db
      .delete(thoughtPromotionsTable)
      .where(eq(thoughtPromotionsTable.toDraftId, articleId));
  }
  for (const thoughtId of createdThoughtIds.splice(0)) {
    await db.delete(thoughtsTable).where(eq(thoughtsTable.id, thoughtId));
  }
  for (const articleId of createdArticleIds.splice(0)) {
    await db.delete(articlesTable).where(eq(articlesTable.id, articleId));
  }
  for (const userId of createdUserIds.splice(0)) {
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

describe("review reverse-promotion database serialization", () => {
  it("makes a concurrent article PATCH lose after the locked review snapshot is reverted", async () => {
    const userId = randomUUID();
    const articleId = randomUUID();
    createdUserIds.push(userId);
    createdArticleIds.push(articleId);

    await db.insert(usersTable).values({
      id: userId,
      email: `reverse-lock-${userId}@example.invalid`,
      nickname: `lock-${userId.slice(0, 8)}`,
    });
    await db.insert(articlesTable).values({
      id: articleId,
      authorId: userId,
      title: "잠글 제목",
      content: "잠글 본문",
      status: "DIVIDING",
    });

    let signalLocked!: () => void;
    const locked = new Promise<void>((resolve) => {
      signalLocked = resolve;
    });
    let releaseLock!: () => void;
    const release = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });

    const revert = db.transaction(async (tx) => {
      const [snapshot] = await tx
        .select()
        .from(articlesTable)
        .where(eq(articlesTable.id, articleId))
        .for("update");
      signalLocked();
      await release;
      const reverted = await tx
        .update(articlesTable)
        .set({ deletedAt: new Date() })
        .where(
          and(
            eq(articlesTable.id, articleId),
            eq(articlesTable.status, "DIVIDING"),
            isNull(articlesTable.deletedAt),
          ),
        )
        .returning({ id: articlesTable.id });
      return { snapshot, reverted };
    });

    await locked;
    let patchSettled = false;
    const concurrentPatch = (async () => {
      const result = await db
        .update(articlesTable)
        .set({ title: "늦은 수정" })
        .where(
          and(
            eq(articlesTable.id, articleId),
            eq(articlesTable.status, "DIVIDING"),
            isNull(articlesTable.deletedAt),
          ),
        )
        .returning({ id: articlesTable.id });
      patchSettled = true;
      return result;
    })();

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(patchSettled).toBe(false);
    releaseLock();
    const [{ snapshot, reverted }, patched] = await Promise.all([revert, concurrentPatch]);

    expect(snapshot?.title).toBe("잠글 제목");
    expect(reverted).toHaveLength(1);
    expect(patched).toHaveLength(0);
  });

  it("lets a deleted thought release its source while rejecting a second active writing thought", async () => {
    const userId = randomUUID();
    const sourceArticleId = randomUUID();
    const deletedThoughtId = randomUUID();
    const activeThoughtId = randomUUID();
    createdUserIds.push(userId);
    createdArticleIds.push(sourceArticleId);
    createdThoughtIds.push(deletedThoughtId, activeThoughtId);

    await db.insert(usersTable).values({
      id: userId,
      email: `reverse-source-${userId}@example.invalid`,
      nickname: `source-${userId.slice(0, 8)}`,
    });
    await db.insert(articlesTable).values({
      id: sourceArticleId,
      authorId: userId,
      title: "원문",
      content: "원문 본문",
      status: "LETTER",
    });
    await db.insert(thoughtsTable).values({
      id: deletedThoughtId,
      authorId: userId,
      content: "# 삭제된 단상\n\n본문",
      createdFrom: "reading",
      sourceArticleId,
      status: "PRELIMINARY",
      deletedAt: new Date(),
    });
    await db.insert(thoughtsTable).values({
      id: activeThoughtId,
      authorId: userId,
      content: "# 활성 단상\n\n본문",
      createdFrom: "reading",
      sourceArticleId,
      status: "PRELIMINARY",
    });

    await expect(
      db.insert(thoughtsTable).values({
        authorId: userId,
        content: "# 충돌 단상\n\n본문",
        createdFrom: "reading",
        sourceArticleId,
        status: "PRELIMINARY",
      }),
    ).rejects.toMatchObject({ cause: { code: "23505", constraint: "thoughts_writing_source_unique_idx" } });
  });

  it("allows multiple cite targets but rejects a second promote origin and invalid foreign keys", async () => {
    const userId = randomUUID();
    const articleId = randomUUID();
    const thoughtIds = Array.from({ length: 5 }, () => randomUUID());
    createdUserIds.push(userId);
    createdArticleIds.push(articleId);
    createdThoughtIds.push(...thoughtIds);

    await db.insert(usersTable).values({
      id: userId,
      email: `reverse-promotion-${userId}@example.invalid`,
      nickname: `promotion-${userId.slice(0, 8)}`,
    });
    await db.insert(articlesTable).values({
      id: articleId,
      authorId: userId,
      title: "검토 글",
      content: "검토 본문",
      status: "DIVIDING",
    });
    await db.insert(thoughtsTable).values(thoughtIds.map((id, index) => ({
      id,
      authorId: userId,
      content: `# 단상 ${index}\n\n본문`,
      createdFrom: "direct" as const,
    })));

    await db.insert(thoughtPromotionsTable).values([
      { fromThoughtId: thoughtIds[0], toDraftId: articleId, promotionType: "cite" },
      { fromThoughtId: thoughtIds[1], toDraftId: articleId, promotionType: "cite" },
      { fromThoughtId: thoughtIds[2], toDraftId: articleId, promotionType: "promote" },
    ]);

    await expect(
      db.insert(thoughtPromotionsTable).values({
        fromThoughtId: thoughtIds[3],
        toDraftId: articleId,
        promotionType: "promote",
      }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "thought_promotions_to_draft_promote_unique_idx" },
    });

    await expect(
      db.insert(thoughtPromotionsTable).values({
        fromThoughtId: thoughtIds[4],
        toDraftId: randomUUID(),
        promotionType: "promote",
      }),
    ).rejects.toMatchObject({
      cause: { code: "23503", constraint: "thought_promotions_to_draft_id_articles_id_fk" },
    });
  });

  it("rolls back the article deletion when an active source thought blocks the revert", async () => {
    const userId = randomUUID();
    const sourceArticleId = randomUUID();
    const reviewArticleId = randomUUID();
    const originalThoughtId = randomUUID();
    const conflictingThoughtId = randomUUID();
    createdUserIds.push(userId);
    createdArticleIds.push(sourceArticleId, reviewArticleId);
    createdThoughtIds.push(originalThoughtId, conflictingThoughtId);

    await db.insert(usersTable).values({
      id: userId,
      email: `reverse-rollback-${userId}@example.invalid`,
      nickname: `rollback-${userId.slice(0, 8)}`,
    });
    await db.insert(articlesTable).values([
      {
        id: sourceArticleId,
        authorId: userId,
        title: "원문",
        content: "원문 본문",
        status: "LETTER",
      },
      {
        id: reviewArticleId,
        authorId: userId,
        title: "검토 글",
        content: "검토 본문",
        status: "DIVIDING",
        sourceArticleId,
      },
    ]);
    await db.insert(thoughtsTable).values([
      {
        id: originalThoughtId,
        authorId: userId,
        content: "# 원본 단상\n\n본문",
        createdFrom: "reading",
        sourceArticleId,
        status: "NORMAL",
      },
      {
        id: conflictingThoughtId,
        authorId: userId,
        content: "# 충돌 단상\n\n본문",
        createdFrom: "reading",
        sourceArticleId,
        status: "PRELIMINARY",
      },
    ]);
    await db.insert(thoughtPromotionsTable).values({
      fromThoughtId: originalThoughtId,
      toDraftId: reviewArticleId,
      promotionType: "promote",
    });

    await expect(
      db.transaction(async (tx) => {
        await tx
          .update(articlesTable)
          .set({ deletedAt: new Date() })
          .where(eq(articlesTable.id, reviewArticleId));
        await tx
          .update(thoughtsTable)
          .set({
            status: "PRELIMINARY",
            migratedFromArticleId: reviewArticleId,
          })
          .where(eq(thoughtsTable.id, originalThoughtId));
        await tx
          .delete(thoughtPromotionsTable)
          .where(eq(thoughtPromotionsTable.fromThoughtId, originalThoughtId));
      }),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "thoughts_writing_source_unique_idx" },
    });

    const [articleAfterConflict] = await db
      .select({ deletedAt: articlesTable.deletedAt })
      .from(articlesTable)
      .where(eq(articlesTable.id, reviewArticleId));
    const [thoughtAfterConflict] = await db
      .select({
        status: thoughtsTable.status,
        migratedFromArticleId: thoughtsTable.migratedFromArticleId,
      })
      .from(thoughtsTable)
      .where(eq(thoughtsTable.id, originalThoughtId));
    const promotionsAfterConflict = await db
      .select({ id: thoughtPromotionsTable.id })
      .from(thoughtPromotionsTable)
      .where(eq(thoughtPromotionsTable.fromThoughtId, originalThoughtId));

    expect(articleAfterConflict.deletedAt).toBeNull();
    expect(thoughtAfterConflict).toEqual({
      status: "NORMAL",
      migratedFromArticleId: null,
    });
    expect(promotionsAfterConflict).toHaveLength(1);
  });
});