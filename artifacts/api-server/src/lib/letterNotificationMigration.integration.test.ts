import { randomUUID } from "node:crypto";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@workspace/db";

/**
 * Proves the sequence-cursor backfill in
 * lib/db/drizzle/0049_sequence_based_letter_notification_ledger.sql is
 * state-preserving: an "already-notified" recipient/slot row (from the
 * pre-Task#2192 claimed_count/notified_count ledger shape) must backfill to
 * a `notified_through_sequence` that already covers every historical
 * letter, so a later wave of new letters for the same slot produces a delta
 * covering only the genuinely new letters — never a duplicate push for
 * letters already delivered under the old scheme.
 *
 * This runs the same window-function ranking + backfill UPDATE the real
 * migration uses (kept in sync with that file's SQL by hand — see the
 * comment on BACKFILL_SQL below) against throwaway scratch tables, rather
 * than the live `inbox` / `letter_arrival_notifications` tables, so it can
 * never mutate real ledger rows or real users' notification history.
 */

const hasDatabase = Boolean(process.env.SUPABASE_DB_URL);

const SCRATCH_INBOX = "test_migration_2192_inbox";
const SCRATCH_LEDGER = "test_migration_2192_ledger";

/**
 * Mirrors the backfill UPDATE in
 * lib/db/drizzle/0049_sequence_based_letter_notification_ledger.sql
 * exactly, with only the two table names swapped for the scratch tables
 * above. Keep this in sync if that migration's backfill logic changes.
 */
function backfillSql(inboxTable: string, ledgerTable: string) {
  return sql.raw(`
    WITH ranked_inbox AS (
      SELECT
        recipient_id,
        visible_at,
        sequence,
        ROW_NUMBER() OVER (PARTITION BY recipient_id, visible_at ORDER BY sequence) AS rn
      FROM "${inboxTable}"
    )
    UPDATE "${ledgerTable}" lan
    SET
      notified_through_sequence = COALESCE(
        (SELECT MAX(ri.sequence) FROM ranked_inbox ri
           WHERE ri.recipient_id = lan.recipient_id
             AND ri.visible_at = lan.delivery_slot
             AND ri.rn <= lan.notified_count),
        0
      ),
      claimed_through_sequence = COALESCE(
        (SELECT MAX(ri.sequence) FROM ranked_inbox ri
           WHERE ri.recipient_id = lan.recipient_id
             AND ri.visible_at = lan.delivery_slot
             AND ri.rn <= lan.claimed_count),
        (SELECT MAX(ri.sequence) FROM ranked_inbox ri
           WHERE ri.recipient_id = lan.recipient_id
             AND ri.visible_at = lan.delivery_slot),
        0
      );
  `);
}

describe.skipIf(!hasDatabase)(
  "letter_arrival_notifications sequence-cursor backfill (Task #2192 upgrade path)",
  () => {
    beforeAll(async () => {
      await db.execute(
        sql.raw(`
          CREATE TABLE IF NOT EXISTS "${SCRATCH_INBOX}" (
            recipient_id uuid NOT NULL,
            visible_at timestamptz NOT NULL,
            sequence bigserial NOT NULL
          );
        `),
      );
      await db.execute(
        sql.raw(`
          CREATE TABLE IF NOT EXISTS "${SCRATCH_LEDGER}" (
            recipient_id uuid NOT NULL,
            delivery_slot timestamptz NOT NULL,
            claimed_count integer NOT NULL,
            notified_count integer NOT NULL,
            claimed_through_sequence bigint,
            notified_through_sequence bigint,
            PRIMARY KEY (recipient_id, delivery_slot)
          );
        `),
      );
    });

    afterAll(async () => {
      await db.execute(sql.raw(`DROP TABLE IF EXISTS "${SCRATCH_INBOX}";`));
      await db.execute(sql.raw(`DROP TABLE IF EXISTS "${SCRATCH_LEDGER}";`));
    });

    it("backfills a fully-resolved old row so historical letters are never re-pushed, and a follow-up letter yields a delta of exactly one", async () => {
      const recipientId = randomUUID();
      const deliverySlot = new Date("2026-01-05T21:00:00.000Z");

      // Three historical letters, already fully notified under the old
      // claimed_count/notified_count scheme (claimed_count === notified_count
      // === 3): this recipient was already pushed for all of them.
      const insertedRows = await db.execute<{ sequence: number }>(sql`
        INSERT INTO ${sql.raw(`"${SCRATCH_INBOX}"`)} (recipient_id, visible_at)
        VALUES
          (${recipientId}::uuid, ${deliverySlot}::timestamptz),
          (${recipientId}::uuid, ${deliverySlot}::timestamptz),
          (${recipientId}::uuid, ${deliverySlot}::timestamptz)
        RETURNING sequence
      `);
      const historicalSequences = insertedRows.rows
        .map((r) => Number(r.sequence))
        .sort((a, b) => a - b);
      expect(historicalSequences).toHaveLength(3);
      const lastHistoricalSequence = historicalSequences[2];

      await db.execute(sql`
        INSERT INTO ${sql.raw(`"${SCRATCH_LEDGER}"`)}
          (recipient_id, delivery_slot, claimed_count, notified_count)
        VALUES (${recipientId}::uuid, ${deliverySlot}::timestamptz, 3, 3)
      `);

      // Run the exact backfill logic from the 0049 migration.
      await db.execute(backfillSql(SCRATCH_INBOX, SCRATCH_LEDGER));

      const backfilled = await db.execute<{
        claimed_through_sequence: number;
        notified_through_sequence: number;
      }>(sql`
        SELECT claimed_through_sequence, notified_through_sequence
        FROM ${sql.raw(`"${SCRATCH_LEDGER}"`)}
        WHERE recipient_id = ${recipientId}::uuid
          AND delivery_slot = ${deliverySlot}::timestamptz
      `);
      expect(backfilled.rows).toHaveLength(1);
      expect(Number(backfilled.rows[0].notified_through_sequence)).toBe(
        lastHistoricalSequence,
      );
      expect(Number(backfilled.rows[0].claimed_through_sequence)).toBe(
        lastHistoricalSequence,
      );

      // No duplicate historical push: none of the 3 already-notified
      // letters should appear in a "what's new since notified_through_sequence"
      // computation immediately after backfill.
      const deltaBeforeNewLetter = await db.execute<{ count: string }>(sql`
        SELECT count(*) AS count
        FROM ${sql.raw(`"${SCRATCH_INBOX}"`)}
        WHERE recipient_id = ${recipientId}::uuid
          AND visible_at = ${deliverySlot}::timestamptz
          AND sequence > ${lastHistoricalSequence}::bigint
      `);
      expect(Number(deltaBeforeNewLetter.rows[0].count)).toBe(0);

      // A genuinely new letter lands in the same exact slot after the
      // backfill (a second same-slot batch).
      const newLetterRow = await db.execute<{ sequence: number }>(sql`
        INSERT INTO ${sql.raw(`"${SCRATCH_INBOX}"`)} (recipient_id, visible_at)
        VALUES (${recipientId}::uuid, ${deliverySlot}::timestamptz)
        RETURNING sequence
      `);
      const newSequence = Number(newLetterRow.rows[0].sequence);
      expect(newSequence).toBeGreaterThan(lastHistoricalSequence);

      // The delta is exactly the one new letter -- not all four -- proving
      // the backfilled notified_through_sequence correctly excludes the
      // historical letters from a follow-up push.
      const deltaAfterNewLetter = await db.execute<{ count: string }>(sql`
        SELECT count(*) AS count
        FROM ${sql.raw(`"${SCRATCH_INBOX}"`)}
        WHERE recipient_id = ${recipientId}::uuid
          AND visible_at = ${deliverySlot}::timestamptz
          AND sequence > ${lastHistoricalSequence}::bigint
      `);
      expect(Number(deltaAfterNewLetter.rows[0].count)).toBe(1);
    });

    it("backfills an unresolved old row (claimed_count > notified_count) so it stays discoverable for retry", async () => {
      const recipientId = randomUUID();
      const deliverySlot = new Date("2026-01-06T21:00:00.000Z");

      // Two letters were claimed, but only the first was ever confirmed
      // notified (the second's push attempt was released after a failure).
      const insertedRows = await db.execute<{ sequence: number }>(sql`
        INSERT INTO ${sql.raw(`"${SCRATCH_INBOX}"`)} (recipient_id, visible_at)
        VALUES
          (${recipientId}::uuid, ${deliverySlot}::timestamptz),
          (${recipientId}::uuid, ${deliverySlot}::timestamptz)
        RETURNING sequence
      `);
      const sequences = insertedRows.rows
        .map((r) => Number(r.sequence))
        .sort((a, b) => a - b);

      await db.execute(sql`
        INSERT INTO ${sql.raw(`"${SCRATCH_LEDGER}"`)}
          (recipient_id, delivery_slot, claimed_count, notified_count)
        VALUES (${recipientId}::uuid, ${deliverySlot}::timestamptz, 2, 1)
      `);

      await db.execute(backfillSql(SCRATCH_INBOX, SCRATCH_LEDGER));

      const backfilled = await db.execute<{
        claimed_through_sequence: number;
        notified_through_sequence: number;
      }>(sql`
        SELECT claimed_through_sequence, notified_through_sequence
        FROM ${sql.raw(`"${SCRATCH_LEDGER}"`)}
        WHERE recipient_id = ${recipientId}::uuid
          AND delivery_slot = ${deliverySlot}::timestamptz
      `);
      expect(Number(backfilled.rows[0].notified_through_sequence)).toBe(
        sequences[0],
      );
      expect(Number(backfilled.rows[0].claimed_through_sequence)).toBe(
        sequences[1],
      );
      // claimed != notified after backfill: this row correctly stays
      // "unresolved" and would be picked up by
      // findDeliverySlotsNeedingLetterPushRetry-style discovery instead of
      // silently looking fully resolved.
      expect(
        Number(backfilled.rows[0].claimed_through_sequence),
      ).not.toBe(Number(backfilled.rows[0].notified_through_sequence));
    });
  },
);
