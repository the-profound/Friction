import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

interface AffectedRow extends Record<string, unknown> {
  id: string;
}

async function main() {
  console.log(
    "🔍 Looking for articles with object-format entries in the pages column...",
  );

  const affected = await db.execute<AffectedRow>(sql`
    SELECT id::text
    FROM articles
    WHERE pages IS NOT NULL
      AND jsonb_typeof(pages) = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(pages) AS elem
        WHERE jsonb_typeof(elem) = 'object'
      )
  `);

  const rows = affected.rows ?? [];
  console.log(`  Found ${rows.length} article(s) to migrate.`);

  if (rows.length === 0) {
    console.log(
      "\n✅ Nothing to migrate — all pages entries are already plain strings.",
    );
    return;
  }

  console.log("\nMigrating...");

  const result = await db.execute(sql`
    UPDATE articles
    SET pages = (
      SELECT jsonb_agg(
        CASE
          WHEN jsonb_typeof(elem) = 'object' THEN to_jsonb(elem->>'content')
          ELSE elem
        END
      )
      FROM jsonb_array_elements(pages) AS elem
    )
    WHERE pages IS NOT NULL
      AND jsonb_typeof(pages) = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(pages) AS elem
        WHERE jsonb_typeof(elem) = 'object'
      )
  `);

  const updated = (result as { rowCount?: number | null }).rowCount ?? 0;
  console.log(`  Updated ${updated} row(s).`);

  const remaining = await db.execute<AffectedRow>(sql`
    SELECT id::text
    FROM articles
    WHERE pages IS NOT NULL
      AND jsonb_typeof(pages) = 'array'
      AND EXISTS (
        SELECT 1
        FROM jsonb_array_elements(pages) AS elem
        WHERE jsonb_typeof(elem) = 'object'
      )
  `);

  const leftover = remaining.rows ?? [];
  if (leftover.length > 0) {
    console.error(
      `\n❌ ${leftover.length} article(s) still have object-format pages after migration.`,
    );
    process.exitCode = 1;
  } else {
    console.log(
      "\n✅ Migration complete — no articles have object-format pages entries.",
    );
  }
}

main()
  .catch((err) => {
    console.error("\n❌ Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
