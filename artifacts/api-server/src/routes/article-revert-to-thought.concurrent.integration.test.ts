import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import { articlesTable, db, usersTable } from "@workspace/db";

const createdArticleIds: string[] = [];
const createdUserIds: string[] = [];

afterEach(async () => {
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
});