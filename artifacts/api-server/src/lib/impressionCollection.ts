import { sql } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

export const IMPRESSION_COLLECTION_NAME = "인상깊은 편지";

type ImpressionCollectionDatabase = Pick<typeof db, "transaction">;
type ImpressionCollectionExecutor = {
  execute: typeof db.execute;
};

/**
 * Restores the one-per-user impression collection invariant.
 *
 * The database's partial unique index on owner_id where is_impression=true is
 * the final concurrency guard. ON CONFLICT makes simultaneous sync/list
 * requests idempotent instead of surfacing the expected uniqueness race.
 */
export async function ensureImpressionCollectionInTransaction(
  ownerId: string,
  tx: ImpressionCollectionExecutor,
): Promise<void> {
  // A transaction-scoped owner lock makes promotion and insertion one serial
  // operation even when sync, list refresh, and startup backfill overlap.
  await tx.execute(sql`
    SELECT pg_advisory_xact_lock(hashtextextended(${ownerId}, 0))
  `);
  await tx.execute(sql`
    UPDATE my_collections
    SET is_public = false, updated_at = NOW()
    WHERE owner_id = ${ownerId}
      AND is_impression = true
      AND is_public = true
  `);
  await tx.execute(sql`
    UPDATE my_collections AS candidate
    SET is_impression = true, is_public = false, updated_at = NOW()
    WHERE candidate.owner_id = ${ownerId}
      AND candidate.name = ${IMPRESSION_COLLECTION_NAME}
      AND candidate.is_impression = false
      AND NOT EXISTS (
        SELECT 1
        FROM my_collections AS existing
        WHERE existing.owner_id = ${ownerId}
          AND existing.is_impression = true
      )
  `);
  await tx.execute(sql`
    INSERT INTO my_collections (
      id,
      owner_id,
      name,
      is_impression,
      is_public,
      created_at,
      updated_at
    )
    SELECT
      gen_random_uuid(),
      ${ownerId},
      ${IMPRESSION_COLLECTION_NAME},
      true,
      false,
      NOW(),
      NOW()
    WHERE NOT EXISTS (
        SELECT 1
        FROM my_collections
        WHERE owner_id = ${ownerId}
          AND is_impression = true
      )
    ON CONFLICT DO NOTHING
  `);
}

export async function ensureImpressionCollection(
  ownerId: string,
  database: ImpressionCollectionDatabase = db,
): Promise<void> {
  await database.transaction(async (tx) => {
    await ensureImpressionCollectionInTransaction(ownerId, tx);
  });
}

type BackfillDatabase = Pick<typeof db, "select" | "transaction">;

export async function backfillImpressionCollections(
  database: BackfillDatabase = db,
): Promise<void> {
  const users = await database.select({ id: usersTable.id }).from(usersTable);
  for (const user of users) {
    await ensureImpressionCollection(user.id, database);
  }
}