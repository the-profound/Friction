import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it } from "vitest";
import {
  articlesTable,
  db,
  thoughtsTable,
  usersTable,
} from "@workspace/db";

import { eraseUserInTransaction } from "./users";

const hasDatabase = Boolean(process.env.SUPABASE_DB_URL);
const createdUserIds: string[] = [];

async function seedCrossUserReference() {
  const targetUserId = randomUUID();
  const survivorUserId = randomUUID();
  const articleId = randomUUID();
  const survivorThoughtId = randomUUID();
  createdUserIds.push(targetUserId, survivorUserId);

  await db.execute(sql`
    INSERT INTO auth.users (
      id,
      aud,
      role,
      email,
      raw_app_meta_data,
      raw_user_meta_data,
      created_at,
      updated_at
    ) VALUES (
      ${targetUserId},
      'authenticated',
      'authenticated',
      ${`delete-auth-${targetUserId}@example.invalid`},
      '{}'::jsonb,
      '{}'::jsonb,
      now(),
      now()
    )
  `);
  await db.insert(usersTable).values([
    {
      id: targetUserId,
      email: `delete-target-${targetUserId}@example.invalid`,
      nickname: `target-${targetUserId.slice(0, 8)}`,
    },
    {
      id: survivorUserId,
      email: `delete-survivor-${survivorUserId}@example.invalid`,
      nickname: `keep-${survivorUserId.slice(0, 8)}`,
    },
  ]);
  await db.insert(articlesTable).values({
    id: articleId,
    authorId: targetUserId,
    title: "account deletion integration target",
    content: "account deletion integration target",
    status: "LETTER",
  });
  await db.insert(thoughtsTable).values({
    id: survivorThoughtId,
    authorId: survivorUserId,
    content: "surviving cross-user thought",
    sourceArticleId: articleId,
    createdFrom: "reading",
  });

  return { targetUserId, survivorUserId, survivorThoughtId };
}

afterEach(async () => {
  const userIds = createdUserIds.splice(0);
  for (const userId of userIds) {
    await db.delete(thoughtsTable).where(eq(thoughtsTable.authorId, userId));
  }
  for (const userId of userIds) {
    await db.delete(articlesTable).where(eq(articlesTable.authorId, userId));
  }
  for (const userId of userIds) {
    await db.delete(usersTable).where(eq(usersTable.id, userId));
    await db.execute(sql`DELETE FROM auth.users WHERE id = ${userId}`);
  }
});

describe.skipIf(!hasDatabase)("account deletion database transaction", () => {
  it("deletes the target while preserving and detaching another user's thought", async () => {
    const { targetUserId, survivorThoughtId } = await seedCrossUserReference();

    await db.transaction((tx) => eraseUserInTransaction(tx, targetUserId));

    const [target] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId));
    const [survivorThought] = await db
      .select({
        id: thoughtsTable.id,
        sourceArticleId: thoughtsTable.sourceArticleId,
      })
      .from(thoughtsTable)
      .where(eq(thoughtsTable.id, survivorThoughtId));

    expect(target).toBeUndefined();
    const authTarget = await db.execute<{ id: string }>(
      sql`SELECT id FROM auth.users WHERE id = ${targetUserId}`,
    );
    expect(authTarget.rows).toHaveLength(0);
    expect(survivorThought).toEqual({
      id: survivorThoughtId,
      sourceArticleId: null,
    });
  }, 30_000);

  it("rolls back all application deletion when the transaction fails after auth cleanup", async () => {
    const { targetUserId } = await seedCrossUserReference();
    const sentinel = new Error("intentional rollback");

    await expect(
      db.transaction(async (tx) => {
        await eraseUserInTransaction(tx, targetUserId);
        throw sentinel;
      }),
    ).rejects.toBe(sentinel);

    const [target] = await db
      .select({ id: usersTable.id })
      .from(usersTable)
      .where(eq(usersTable.id, targetUserId));
    expect(target?.id).toBe(targetUserId);
    const authTarget = await db.execute<{ id: string }>(
      sql`SELECT id FROM auth.users WHERE id = ${targetUserId}`,
    );
    expect(authTarget.rows).toEqual([{ id: targetUserId }]);
  }, 30_000);

  it("allows concurrent duplicate deletion attempts to complete safely", async () => {
    const { targetUserId } = await seedCrossUserReference();

    await expect(
      Promise.all([
        db.transaction((tx) => eraseUserInTransaction(tx, targetUserId)),
        db.transaction((tx) => eraseUserInTransaction(tx, targetUserId)),
      ]),
    ).resolves.toEqual([undefined, undefined]);
    const authTarget = await db.execute<{ id: string }>(
      sql`SELECT id FROM auth.users WHERE id = ${targetUserId}`,
    );
    expect(authTarget.rows).toHaveLength(0);
  }, 60_000);
});