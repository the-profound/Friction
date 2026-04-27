import { pool } from "@workspace/db";
import { seedDevData } from "./seed";

async function main() {
  await seedDevData();
  await pool.end();
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
