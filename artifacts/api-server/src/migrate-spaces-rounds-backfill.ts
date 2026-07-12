/**
 * One-time migration: backfill weekly space_rounds for team_collection-derived spaces
 *
 * For every space whose id appears in team_collections:
 *   - Delete the single round_number=1 placeholder and replace with 7-day rounds
 *     covering the period from starts_at (or created_at) through the last letter's
 *     created_at (or created_at + 7 days when there are no letters).
 *   - Re-assign every space_letter to the correct weekly round.
 *   - Mark all space_rounds as COMPLETED and all spaces as ARCHIVED.
 *   - Set spaces.round_count to the actual number of rounds created.
 *   - Set spaces.default_center_count = 100.
 *
 * Fully idempotent — safe to run multiple times.
 *
 * Run:
 *   pnpm --filter @workspace/api-server migrate:rounds-backfill
 */

import { pool } from "@workspace/db";

async function main() {
  const client = await pool.connect();
  try {
    // -----------------------------------------------------------------------
    // 0. Guard: check there are team_collections-derived spaces to process
    // -----------------------------------------------------------------------
    const { rows: tcRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count
       FROM spaces s
       WHERE s.id IN (SELECT id FROM team_collections)`,
    );
    const spaceCount = parseInt(tcRows[0].count, 10);

    if (spaceCount === 0) {
      console.log("[backfill] No team_collection-derived spaces found — nothing to do.");
      return;
    }
    console.log(`[backfill] Found ${spaceCount} space(s) to backfill. Starting…`);

    await client.query("BEGIN");

    // -----------------------------------------------------------------------
    // 1. Build a temporary view of space date ranges
    //    space_start  = COALESCE(starts_at, created_at)
    //    total_rounds = FLOOR(last_letter_days/7)+1, using half-open weekly buckets:
    //                   round 1=[0,7d), round 2=[7d,14d), ...
    //                   Spaces with no letters always get total_rounds=1.
    // -----------------------------------------------------------------------
    await client.query(`
      CREATE TEMP TABLE _space_ranges AS
      SELECT
        s.id                                                          AS space_id,
        COALESCE(s.starts_at, s.created_at)                          AS space_start,
        CASE
          WHEN MAX(sl.created_at) IS NULL THEN 1
          ELSE GREATEST(
            1,
            FLOOR(
              EXTRACT(EPOCH FROM
                MAX(sl.created_at) - COALESCE(s.starts_at, s.created_at)
              ) / (7.0 * 86400)
            )::int + 1
          )
        END                                                           AS total_rounds
      FROM spaces s
      LEFT JOIN space_letters sl ON sl.space_id = s.id
      WHERE s.id IN (SELECT id FROM team_collections)
      GROUP BY s.id
    `);

    // -----------------------------------------------------------------------
    // 2a. Cleanup: remove excess rounds whose round_number > computed total_rounds.
    //     This ensures idempotency even when re-running after a prior run that used a
    //     different formula.  Letters in excess rounds are detached first to avoid FK
    //     violations, then the excess rounds are deleted.
    // -----------------------------------------------------------------------
    const detachResult = await client.query(`
      UPDATE space_letters sl
      SET space_round_id = NULL, updated_at = NOW()
      FROM space_rounds sr
      JOIN _space_ranges r ON r.space_id = sr.space_id
      WHERE sl.space_round_id = sr.id
        AND sr.round_number > r.total_rounds
    `);
    if ((detachResult.rowCount ?? 0) > 0) {
      console.log(`[backfill] letters detached from excess rounds: ${detachResult.rowCount}`);
    }

    const deleteExcessResult = await client.query(`
      DELETE FROM space_rounds sr
      USING _space_ranges r
      WHERE sr.space_id = r.space_id
        AND sr.round_number > r.total_rounds
    `);
    if ((deleteExcessResult.rowCount ?? 0) > 0) {
      console.log(`[backfill] excess space_rounds deleted: ${deleteExcessResult.rowCount}`);
    }

    // -----------------------------------------------------------------------
    // 2b. Insert weekly space_rounds (ON CONFLICT DO NOTHING = idempotent)
    //    round_number comes from generate_series(1, total_rounds)
    // -----------------------------------------------------------------------
    const roundsResult = await client.query(`
      INSERT INTO space_rounds (id, space_id, round_number, status, created_at, updated_at)
      SELECT
        gen_random_uuid(),
        r.space_id,
        gs.rn,
        'COMPLETED'::space_round_status,
        NOW(),
        NOW()
      FROM _space_ranges r
      CROSS JOIN LATERAL generate_series(1, r.total_rounds) AS gs(rn)
      ON CONFLICT ON CONSTRAINT space_rounds_space_round_unique DO NOTHING
    `);
    console.log(`[backfill] space_rounds inserted: ${roundsResult.rowCount}`);

    // -----------------------------------------------------------------------
    // 3. Re-assign space_letters to the correct weekly round
    //    round_number = FLOOR(days_from_start / 7) + 1, clamped to [1, total_rounds]
    //    Half-open buckets: round 1=[0,7d), round 2=[7d,14d), ...
    //    Letters that pre-date space_start (negative offset) fall into round 1.
    //    Uses a CTE to pre-compute assignments — PostgreSQL does not allow
    //    referencing the update-target table inside a FROM-clause JOIN condition.
    // -----------------------------------------------------------------------
    const lettersResult = await client.query(`
      WITH assignments AS (
        SELECT
          sl.id AS letter_id,
          sr.id AS round_id
        FROM space_letters sl
        JOIN _space_ranges r ON r.space_id = sl.space_id
        JOIN space_rounds sr
          ON sr.space_id = r.space_id
          AND sr.round_number = GREATEST(
            1,
            LEAST(
              r.total_rounds,
              FLOOR(
                EXTRACT(EPOCH FROM (sl.created_at - r.space_start)) / (7.0 * 86400)
              )::int + 1
            )
          )
      )
      UPDATE space_letters sl
      SET
        space_round_id = a.round_id,
        updated_at     = NOW()
      FROM assignments a
      WHERE sl.id = a.letter_id
    `);
    console.log(`[backfill] space_letters reassigned: ${lettersResult.rowCount}`);

    // -----------------------------------------------------------------------
    // 4. Update spaces: ARCHIVED, correct round_count, default_center_count=100
    // -----------------------------------------------------------------------
    const spacesResult = await client.query(`
      UPDATE spaces s
      SET
        status                = 'ARCHIVED'::space_status,
        round_count           = r.total_rounds,
        default_center_count  = 100,
        updated_at            = NOW()
      FROM _space_ranges r
      WHERE s.id = r.space_id
    `);
    console.log(`[backfill] spaces updated: ${spacesResult.rowCount}`);

    // -----------------------------------------------------------------------
    // 5. Mark all space_rounds for these spaces as COMPLETED
    //    (covers any rounds that were already there before this run)
    // -----------------------------------------------------------------------
    const roundStatusResult = await client.query(`
      UPDATE space_rounds sr
      SET
        status     = 'COMPLETED'::space_round_status,
        updated_at = NOW()
      WHERE sr.space_id IN (SELECT id FROM team_collections)
        AND sr.status != 'COMPLETED'
    `);
    console.log(`[backfill] space_rounds marked COMPLETED: ${roundStatusResult.rowCount}`);

    await client.query("COMMIT");

    // -----------------------------------------------------------------------
    // 6. Verification
    // -----------------------------------------------------------------------
    const { rows: vSpaces } = await client.query<{
      space_id: string; status: string; round_count: number; default_center_count: number; total_rounds: string;
    }>(`
      SELECT
        s.id            AS space_id,
        s.status,
        s.round_count,
        s.default_center_count,
        COUNT(sr.id)::text AS total_rounds
      FROM spaces s
      LEFT JOIN space_rounds sr ON sr.space_id = s.id
      WHERE s.id IN (SELECT id FROM team_collections)
      GROUP BY s.id
      ORDER BY s.id
    `);

    const { rows: vLettersUnassigned } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM space_letters sl
      WHERE sl.space_id IN (SELECT id FROM team_collections)
        AND sl.space_round_id IS NULL
    `);

    const { rows: vRoundsNotCompleted } = await client.query<{ count: string }>(`
      SELECT COUNT(*)::text AS count
      FROM space_rounds sr
      WHERE sr.space_id IN (SELECT id FROM team_collections)
        AND sr.status != 'COMPLETED'
    `);

    // Invariant: spaces.round_count must equal COUNT(space_rounds) for every space
    const mismatchedSpaces = vSpaces.filter(
      (row) => row.round_count !== parseInt(row.total_rounds, 10),
    );

    console.log("\n[backfill] ✓ Backfill complete. Verification:");
    console.log(`  Spaces processed: ${vSpaces.length}`);
    for (const row of vSpaces) {
      const ok = row.round_count === parseInt(row.total_rounds, 10) ? "✓" : "✗";
      console.log(
        `  ${ok} ${row.space_id} — status=${row.status}, round_count=${row.round_count}, ` +
        `actual_rounds=${row.total_rounds}, default_center_count=${row.default_center_count}`,
      );
    }
    console.log(`  space_letters with NULL round (should be 0): ${vLettersUnassigned[0].count}`);
    console.log(`  space_rounds not COMPLETED (should be 0):    ${vRoundsNotCompleted[0].count}`);
    console.log(`  spaces where round_count ≠ actual rounds (should be 0): ${mismatchedSpaces.length}`);
    if (mismatchedSpaces.length > 0) {
      console.error("[backfill] ✗ round_count mismatch detected — re-run or investigate:");
      for (const row of mismatchedSpaces) {
        console.error(`    ${row.space_id}: round_count=${row.round_count}, actual=${row.total_rounds}`);
      }
      process.exit(1);
    }
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[backfill] Migration failed — rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
