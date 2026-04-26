import { db, pool } from "@workspace/db";
import { sql } from "drizzle-orm";

function deriveNicknameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const sanitized = local.replace(/[^A-Za-z0-9가-힣._-]/g, "").trim();
  const fallback = sanitized.length > 0 ? sanitized : "user";
  return fallback.slice(0, 20);
}

interface MissingRow extends Record<string, unknown> {
  id: string;
  email: string;
  email_taken: boolean;
}

async function main() {
  console.log("🔍 Looking up auth.users without a matching public.users row...");

  const result = await db.execute<MissingRow>(sql`
    SELECT
      au.id::text AS id,
      au.email,
      EXISTS (
        SELECT 1 FROM public.users pu
        WHERE pu.email = au.email AND pu.id <> au.id
      ) AS email_taken
    FROM auth.users au
    LEFT JOIN public.users pu ON pu.id = au.id
    WHERE pu.id IS NULL
      AND au.email IS NOT NULL
      AND au.email <> ''
    ORDER BY au.created_at ASC
  `);

  const missing = result.rows ?? [];
  console.log(`  Found ${missing.length} missing row(s).`);

  if (missing.length === 0) {
    console.log("\n✅ Nothing to backfill — every auth.users row already has a public.users row.");
    return;
  }

  let inserted = 0;
  let alreadyPresent = 0;
  const skippedEmailCollisions: Array<{ id: string; email: string }> = [];

  for (const row of missing) {
    if (row.email_taken) {
      // A different public.users row already owns this email — leave it alone
      // so the unique(email) constraint is preserved. The operator can resolve
      // the collision manually and re-run.
      skippedEmailCollisions.push({ id: row.id, email: row.email });
      continue;
    }

    const nickname = deriveNicknameFromEmail(row.email);

    // ON CONFLICT (id) DO NOTHING keeps the script idempotent: if another
    // process inserted the row between SELECT and INSERT, we just move on.
    const insertRes = await db.execute(sql`
      INSERT INTO public.users (id, email, nickname)
      VALUES (${row.id}::uuid, ${row.email}, ${nickname})
      ON CONFLICT (id) DO NOTHING
    `);

    const rowCount = (insertRes as { rowCount?: number | null }).rowCount ?? 0;
    if (rowCount > 0) {
      inserted += 1;
      console.log(`  ✓ ${row.email} → nickname="${nickname}" (id=${row.id})`);
    } else {
      alreadyPresent += 1;
    }
  }

  console.log(
    `\n📊 Summary: inserted=${inserted}, already_present=${alreadyPresent}, skipped_email_collisions=${skippedEmailCollisions.length}`,
  );

  if (skippedEmailCollisions.length > 0) {
    console.warn(
      "\n⚠️  The following auth.users rows share an email with a different public.users row and were NOT inserted:",
    );
    for (const s of skippedEmailCollisions) {
      console.warn(`     - ${s.email} (auth.users.id=${s.id})`);
    }
    console.warn(
      "     Resolve the collision (e.g. delete the stale public.users row or update its id) and re-run.",
    );
    process.exitCode = 1;
  } else {
    console.log("\n✅ Backfill complete.");
  }
}

main()
  .catch((err) => {
    console.error("\n❌ Backfill failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await pool.end();
  });
