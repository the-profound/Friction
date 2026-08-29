import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

const hasDatabase = Boolean(process.env.SUPABASE_DB_URL);
const describeWithDatabase = hasDatabase ? describe : describe.skip;

describeWithDatabase("inbox space-source SQL", () => {
  let client: Awaited<ReturnType<(typeof import("@workspace/db"))["pool"]["connect"]>>;
  let inboxTable: (typeof import("@workspace/db"))["inboxTable"];
  let inboxSpaceIdSubquery: (typeof import("./inbox"))["inboxSpaceIdSubquery"];

  const UUIDS = {
    explicitSpace: "00000000-0000-4000-8000-000000000001",
    linkedSpace: "00000000-0000-4000-8000-000000000002",
    legacySpaceA: "00000000-0000-4000-8000-000000000003",
    legacySpaceB: "00000000-0000-4000-8000-000000000004",
    articleUnique: "10000000-0000-4000-8000-000000000001",
    articleAmbiguous: "10000000-0000-4000-8000-000000000002",
    articlePerson: "10000000-0000-4000-8000-000000000003",
    articleTeam: "10000000-0000-4000-8000-000000000004",
    sender: "20000000-0000-4000-8000-000000000001",
    linkedSend: "30000000-0000-4000-8000-000000000001",
    team: "40000000-0000-4000-8000-000000000001",
  } as const;

  beforeAll(async () => {
    const dbModule = await import("@workspace/db");
    const inboxRoute = await import("./inbox");
    client = await dbModule.pool.connect();
    inboxTable = dbModule.inboxTable;
    inboxSpaceIdSubquery = inboxRoute.inboxSpaceIdSubquery;

    await client.query("BEGIN");
    await client.query(`
      CREATE TEMP TABLE inbox (
        id uuid PRIMARY KEY,
        source_space_id uuid,
        source_space_scheduled_send_id uuid,
        source_team_collection_id uuid,
        article_id uuid NOT NULL,
        sender_id uuid NOT NULL,
        visible_at timestamptz NOT NULL
      ) ON COMMIT DROP;
      CREATE TEMP TABLE space_letters (
        id uuid PRIMARY KEY,
        space_id uuid NOT NULL,
        source_article_id uuid,
        author_id uuid NOT NULL
      ) ON COMMIT DROP;
      CREATE TEMP TABLE space_scheduled_sends (
        id uuid PRIMARY KEY,
        space_id uuid NOT NULL,
        space_letter_id uuid NOT NULL,
        status text NOT NULL,
        scheduled_at timestamptz NOT NULL
      ) ON COMMIT DROP;
      CREATE TEMP TABLE send_records (
        inbox_id uuid
      ) ON COMMIT DROP;
    `);
  });

  afterAll(async () => {
    if (!client) return;
    await client.query("ROLLBACK");
    client.release();
  });

  it("prioritizes explicit and linked space IDs and rejects unsafe legacy guesses", async () => {
    const at = "2026-08-29T06:00:00.000Z";
    const rowIds = {
      explicit: "50000000-0000-4000-8000-000000000001",
      linked: "50000000-0000-4000-8000-000000000002",
      uniqueLegacy: "50000000-0000-4000-8000-000000000003",
      ambiguousLegacy: "50000000-0000-4000-8000-000000000004",
      person: "50000000-0000-4000-8000-000000000005",
      team: "50000000-0000-4000-8000-000000000006",
    } as const;

    await client.query(
      `INSERT INTO space_letters (id, space_id, source_article_id, author_id) VALUES
        ('60000000-0000-4000-8000-000000000001', $1, $4, $7),
        ('60000000-0000-4000-8000-000000000002', $2, $5, $7),
        ('60000000-0000-4000-8000-000000000003', $3, $5, $7),
        ('60000000-0000-4000-8000-000000000004', $1, $6, $7),
        ('60000000-0000-4000-8000-000000000005', $1, $8, $7)`,
      [
        UUIDS.legacySpaceA,
        UUIDS.legacySpaceA,
        UUIDS.legacySpaceB,
        UUIDS.articleUnique,
        UUIDS.articleAmbiguous,
        UUIDS.articlePerson,
        UUIDS.sender,
        UUIDS.articleTeam,
      ],
    );
    await client.query(
      `INSERT INTO space_scheduled_sends
        (id, space_id, space_letter_id, status, scheduled_at) VALUES
        ($1, $2, '60000000-0000-4000-8000-000000000001', 'SENT', $5),
        ('70000000-0000-4000-8000-000000000001', $3, '60000000-0000-4000-8000-000000000001', 'SENT', $5),
        ('70000000-0000-4000-8000-000000000002', $3, '60000000-0000-4000-8000-000000000002', 'SENT', $5),
        ('70000000-0000-4000-8000-000000000003', $4, '60000000-0000-4000-8000-000000000003', 'SENT', $5),
        ('70000000-0000-4000-8000-000000000004', $3, '60000000-0000-4000-8000-000000000004', 'SENT', $5),
        ('70000000-0000-4000-8000-000000000005', $3, '60000000-0000-4000-8000-000000000005', 'SENT', $5)`,
      [
        UUIDS.linkedSend,
        UUIDS.linkedSpace,
        UUIDS.legacySpaceA,
        UUIDS.legacySpaceB,
        at,
      ],
    );
    await client.query(
      `INSERT INTO inbox (
        id, source_space_id, source_space_scheduled_send_id,
        source_team_collection_id, article_id, sender_id, visible_at
      ) VALUES
        ($1, $2, $3, NULL, $9, $13, $14),
        ($4, NULL, $3, NULL, $9, $13, $14),
        ($5, NULL, NULL, NULL, $9, $13, $14),
        ($6, NULL, NULL, NULL, $10, $13, $14),
        ($7, NULL, NULL, NULL, $11, $13, $14),
        ($8, NULL, NULL, $15, $12, $13, $14)`,
      [
        rowIds.explicit,
        UUIDS.explicitSpace,
        UUIDS.linkedSend,
        rowIds.linked,
        rowIds.uniqueLegacy,
        rowIds.ambiguousLegacy,
        rowIds.person,
        rowIds.team,
        UUIDS.articleUnique,
        UUIDS.articleAmbiguous,
        UUIDS.articlePerson,
        UUIDS.articleTeam,
        UUIDS.sender,
        at,
        UUIDS.team,
      ],
    );
    await client.query(
      "INSERT INTO send_records (inbox_id) VALUES ($1)",
      [rowIds.person],
    );

    const dialect = new PgDialect();
    const query = dialect.sqlToQuery(sql`
      SELECT
        ${inboxTable.id} AS id,
        ${inboxSpaceIdSubquery} AS source_space_id
      FROM ${inboxTable}
      ORDER BY ${inboxTable.id}
    `);
    const result = await client.query(query.sql, query.params);
    const sourceByRow = new Map(
      result.rows.map((row) => [row.id as string, row.source_space_id as string | null]),
    );

    expect(sourceByRow.get(rowIds.explicit)).toBe(UUIDS.explicitSpace);
    expect(sourceByRow.get(rowIds.linked)).toBe(UUIDS.linkedSpace);
    expect(sourceByRow.get(rowIds.uniqueLegacy)).toBe(UUIDS.legacySpaceA);
    expect(sourceByRow.get(rowIds.ambiguousLegacy)).toBeNull();
    expect(sourceByRow.get(rowIds.person)).toBeNull();
    expect(sourceByRow.get(rowIds.team)).toBeNull();
  });
});