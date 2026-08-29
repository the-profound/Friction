/**
 * Backward-compatible migration entry point.
 *
 * This script used to enforce one OPENING letter per round. That policy was
 * removed; keeping the command as an idempotent index drop prevents an older
 * deployment runbook from recreating or depending on the obsolete constraint.
 */
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

async function main() {
  await db.execute(sql`
    DROP INDEX IF EXISTS space_letters_opening_per_round_unique
  `);
  console.log("Removed obsolete index space_letters_opening_per_round_unique.");
}

main()
  .then(() => {
    console.log("Done.");
    process.exit(0);
  })
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });