import { afterEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import { db, myCollectionsTable, usersTable } from "@workspace/db";
import {
  backfillImpressionCollections,
  ensureImpressionCollection,
  IMPRESSION_COLLECTION_NAME,
} from "./impressionCollection";

describe("impression collection invariant", () => {
  const integrationUserId = "18250000-0000-4000-a000-000000000001";
  const backfillUserId = "18250000-0000-4000-a000-000000000002";

  afterEach(async () => {
    await db.delete(myCollectionsTable).where(eq(myCollectionsTable.ownerId, integrationUserId));
    await db.delete(myCollectionsTable).where(eq(myCollectionsTable.ownerId, backfillUserId));
    await db.delete(usersTable).where(eq(usersTable.id, integrationUserId));
    await db.delete(usersTable).where(eq(usersTable.id, backfillUserId));
  });

  it("uses one canonical private folder definition for repair and backfill", async () => {
    const execute = vi.fn(async (_query: unknown) => undefined);
    const transaction = vi.fn(async (
      callback: (tx: { execute: typeof execute }) => Promise<void>,
    ) => callback({ execute }));

    await ensureImpressionCollection(
      "11111111-1111-4111-8111-111111111111",
      { transaction } as never,
    );

    expect(transaction).toHaveBeenCalledOnce();
    expect(execute).toHaveBeenCalledTimes(4);
    const queryText = execute.mock.calls
      .map(([query]) => {
        const sqlQuery = query as { queryChunks?: Array<{ value?: string[] }> };
        return sqlQuery.queryChunks?.flatMap((chunk) => chunk.value ?? []).join(" ") ?? "";
      })
      .join("\n");
    expect(queryText).toContain("pg_advisory_xact_lock");
    expect(queryText).toContain("is_impression = true");
    expect(queryText).toContain("is_public = false");
    expect(queryText).toContain("ON CONFLICT DO NOTHING");

    expect(IMPRESSION_COLLECTION_NAME).toBe("인상깊은 편지");
  });

  it("promotes a same-name folder and remains single under concurrent repairs", async () => {
    await db.insert(usersTable).values({
      id: integrationUserId,
      email: "impression-invariant-1825@example.test",
      nickname: "impression-test",
    });
    const [regularFolder] = await db.insert(myCollectionsTable).values({
      ownerId: integrationUserId,
      name: IMPRESSION_COLLECTION_NAME,
      isPublic: true,
      isImpression: false,
    }).returning();

    await Promise.all(
      Array.from({ length: 8 }, () => ensureImpressionCollection(integrationUserId)),
    );

    const folders = await db
      .select()
      .from(myCollectionsTable)
      .where(eq(myCollectionsTable.ownerId, integrationUserId));
    expect(folders).toHaveLength(1);
    expect(folders[0]).toMatchObject({
      id: regularFolder?.id,
      name: IMPRESSION_COLLECTION_NAME,
      isImpression: true,
      isPublic: false,
    });

    await ensureImpressionCollection(integrationUserId);
    const impressions = await db
      .select()
      .from(myCollectionsTable)
      .where(and(
        eq(myCollectionsTable.ownerId, integrationUserId),
        eq(myCollectionsTable.isImpression, true),
      ));
    expect(impressions).toHaveLength(1);

    await db
      .update(myCollectionsTable)
      .set({ isPublic: true })
      .where(eq(myCollectionsTable.id, impressions[0]!.id));
    await ensureImpressionCollection(integrationUserId);
    const [normalized] = await db
      .select()
      .from(myCollectionsTable)
      .where(eq(myCollectionsTable.id, impressions[0]!.id));
    expect(normalized?.isPublic).toBe(false);
  }, 20_000);

  it("repairs legacy rows through the startup backfill entry point", async () => {
    await db.insert(usersTable).values([
      {
        id: integrationUserId,
        email: "impression-backfill-regular@example.test",
        nickname: "backfill-regular",
      },
      {
        id: backfillUserId,
        email: "impression-backfill-public@example.test",
        nickname: "backfill-public",
      },
    ]);
    await db.insert(myCollectionsTable).values([
      {
        ownerId: integrationUserId,
        name: IMPRESSION_COLLECTION_NAME,
        isPublic: true,
        isImpression: false,
      },
      {
        ownerId: backfillUserId,
        name: IMPRESSION_COLLECTION_NAME,
        isPublic: true,
        isImpression: true,
      },
    ]);

    const select = vi.fn(() => ({
      from: vi.fn(async () => [
        { id: integrationUserId },
        { id: backfillUserId },
      ]),
    }));
    await backfillImpressionCollections({
      select,
      transaction: db.transaction.bind(db),
    } as never);

    const repaired = await db
      .select()
      .from(myCollectionsTable)
      .where(and(
        eq(myCollectionsTable.isImpression, true),
        eq(myCollectionsTable.isPublic, false),
      ));
    const repairedOwners = repaired
      .filter((folder) =>
        folder.ownerId === integrationUserId || folder.ownerId === backfillUserId)
      .map((folder) => folder.ownerId)
      .sort();
    expect(repairedOwners).toEqual([integrationUserId, backfillUserId].sort());
  }, 20_000);
});