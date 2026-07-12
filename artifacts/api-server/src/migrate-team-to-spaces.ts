/**
 * One-time migration: team_collections → spaces
 *
 * Reads production team_collections data and converts it to the spaces schema.
 * Fully idempotent — safe to run multiple times (ON CONFLICT DO NOTHING / NOT EXISTS guards).
 *
 * Run:
 *   pnpm --filter @workspace/api-server tsx src/migrate-team-to-spaces.ts
 */

import { pool } from "@workspace/db";

async function main() {
  const client = await pool.connect();
  try {
    // -----------------------------------------------------------------------
    // 0. Check if there is any data to migrate
    // -----------------------------------------------------------------------
    const { rows: tcRows } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM team_collections`,
    );
    const teamCollectionCount = parseInt(tcRows[0].count, 10);

    if (teamCollectionCount === 0) {
      console.log("[migrate] No team_collections rows found — nothing to do.");
      return;
    }
    console.log(`[migrate] Found ${teamCollectionCount} team_collection(s). Starting migration…`);

    await client.query("BEGIN");

    // -----------------------------------------------------------------------
    // 1. spaces — preserve the same UUID so other FK references can stay stable
    //    Required NOT NULL columns with no default that we must supply:
    //      name, creator_id
    //    Columns that have defaults (we use them):
    //      is_anonymous=false, round_count=1, default_center_interval=7,
    //      default_center_count=1, status=RECRUITING
    // -----------------------------------------------------------------------
    const spaceInsertResult = await client.query(`
      INSERT INTO spaces (
        id, name, description, is_anonymous, round_count,
        default_center_interval, default_center_count,
        status, creator_id, created_at, updated_at
      )
      SELECT
        tc.id,
        tc.name,
        tc.description,
        false,
        1,
        7,
        1,
        'RECRUITING',
        tc.creator_id,
        tc.created_at,
        tc.updated_at
      FROM team_collections tc
      ON CONFLICT (id) DO NOTHING
    `);
    console.log(`[migrate] spaces inserted: ${spaceInsertResult.rowCount}`);

    // -----------------------------------------------------------------------
    // 2. space_participations
    //    OWNER → OPERATOR, MEMBER → PARTICIPANT
    //    join_path = NULL, status = APPROVED (satisfies CHECK constraints)
    // -----------------------------------------------------------------------
    const participationsInsertResult = await client.query(`
      INSERT INTO space_participations (
        id, space_id, user_id, role, join_path, status,
        invitation_id, code_request_id, created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        tcm.team_collection_id,
        tcm.user_id,
        CASE tcm.role
          WHEN 'OWNER'   THEN 'OPERATOR'::space_member_role
          WHEN 'MEMBER'  THEN 'PARTICIPANT'::space_member_role
        END,
        NULL,
        'APPROVED'::space_participation_status,
        NULL,
        NULL,
        tcm.joined_at,
        tcm.joined_at
      FROM team_collection_memberships tcm
      -- Only migrate memberships for spaces that actually exist (were migrated)
      WHERE EXISTS (SELECT 1 FROM spaces s WHERE s.id = tcm.team_collection_id)
      ON CONFLICT ON CONSTRAINT space_participations_space_user_unique DO NOTHING
    `);
    console.log(`[migrate] space_participations inserted: ${participationsInsertResult.rowCount}`);

    // -----------------------------------------------------------------------
    // 3. space_rounds — one round per space, round_number=1, status=ACTIVE
    // -----------------------------------------------------------------------
    const roundsInsertResult = await client.query(`
      INSERT INTO space_rounds (
        id, space_id, round_number, status, created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        s.id,
        1,
        'ACTIVE'::space_round_status,
        s.created_at,
        s.updated_at
      FROM spaces s
      -- Only for spaces that were migrated from team_collections
      WHERE EXISTS (SELECT 1 FROM team_collections tc WHERE tc.id = s.id)
      ON CONFLICT ON CONSTRAINT space_rounds_space_round_unique DO NOTHING
    `);
    console.log(`[migrate] space_rounds inserted: ${roundsInsertResult.rowCount}`);

    // -----------------------------------------------------------------------
    // 4. space_letters
    //    Source: team_collection_articles where deleted_at IS NULL
    //    letter_type = CENTER, source_article_id = article_id
    //    author_id comes from the articles table
    //    space_round_id = the round just created (round_number=1) for the space
    //    Idempotency: NOT EXISTS guard on (space_round_id, source_article_id)
    // -----------------------------------------------------------------------
    const lettersInsertResult = await client.query(`
      INSERT INTO space_letters (
        id, space_id, space_round_id, author_id, source_article_id,
        letter_type, is_public, created_at, updated_at
      )
      SELECT
        gen_random_uuid(),
        tca.team_collection_id,
        sr.id,
        a.author_id,
        tca.article_id,
        'CENTER'::space_letter_type,
        false,
        tca.added_at,
        tca.added_at
      FROM team_collection_articles tca
      JOIN articles a ON a.id = tca.article_id
      JOIN space_rounds sr
        ON sr.space_id = tca.team_collection_id
        AND sr.round_number = 1
      WHERE tca.deleted_at IS NULL
        -- Only for spaces migrated from team_collections
        AND EXISTS (SELECT 1 FROM spaces s WHERE s.id = tca.team_collection_id)
        -- Idempotency: skip if already migrated
        AND NOT EXISTS (
          SELECT 1 FROM space_letters sl
          WHERE sl.space_round_id = sr.id
            AND sl.source_article_id = tca.article_id
        )
    `);
    console.log(`[migrate] space_letters inserted: ${lettersInsertResult.rowCount}`);

    await client.query("COMMIT");

    // -----------------------------------------------------------------------
    // 5. Verification — print row counts
    // -----------------------------------------------------------------------
    const { rows: verifySpaces } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM spaces WHERE id IN (SELECT id FROM team_collections)`,
    );
    const { rows: verifyParticipations } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM space_participations sp
       WHERE EXISTS (SELECT 1 FROM team_collections tc WHERE tc.id = sp.space_id)`,
    );
    const { rows: verifyRounds } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM space_rounds sr
       WHERE EXISTS (SELECT 1 FROM team_collections tc WHERE tc.id = sr.space_id)`,
    );
    const { rows: verifyLetters } = await client.query<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM space_letters sl
       WHERE EXISTS (SELECT 1 FROM team_collections tc WHERE tc.id = sl.space_id)`,
    );

    console.log("\n[migrate] ✓ Migration complete. Verification:");
    console.log(`  spaces migrated:               ${verifySpaces[0].count}`);
    console.log(`  space_participations migrated: ${verifyParticipations[0].count}`);
    console.log(`  space_rounds migrated:         ${verifyRounds[0].count}`);
    console.log(`  space_letters migrated:        ${verifyLetters[0].count}`);
  } catch (err) {
    await client.query("ROLLBACK");
    console.error("[migrate] Migration failed — rolled back:", err);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

main();
