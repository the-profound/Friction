/**
 * Read-only check: how many recipients are affected by today's missed
 * 06:00 KST letter-arrived push, and how many already have a claim row.
 *
 * Run: pnpm --filter @workspace/api-server exec tsx src/scripts/checkMissedSlot.ts
 */
import { db, inboxTable, letterArrivalNotificationsTable, pushTokensTable, usersTable, pool } from "@workspace/db";
import { eq, inArray, sql } from "drizzle-orm";
import { normalizeToKst6 } from "../lib/deliverySlot";

async function main() {
  const deliverySlot = normalizeToKst6(new Date());

  const rows = await db
    .select({
      userId: usersTable.id,
      nickname: usersTable.nickname,
      newLetterCount: sql<number>`cast(count(${inboxTable.id}) as int)`,
    })
    .from(inboxTable)
    .innerJoin(usersTable, sql`${usersTable.id} = ${inboxTable.recipientId}`)
    .where(eq(inboxTable.visibleAt, deliverySlot))
    .groupBy(usersTable.id, usersTable.nickname);

  const alreadyClaimed = await db
    .select({ recipientId: letterArrivalNotificationsTable.recipientId })
    .from(letterArrivalNotificationsTable)
    .where(eq(letterArrivalNotificationsTable.deliverySlot, deliverySlot));

  const userIds = rows.map((r) => r.userId);
  const tokenRows = userIds.length
    ? await db
        .select({ userId: pushTokensTable.userId })
        .from(pushTokensTable)
        .where(inArray(pushTokensTable.userId, userIds))
    : [];
  const withTokens = new Set(tokenRows.map((t) => t.userId)).size;

  console.log(JSON.stringify({
    deliverySlot: deliverySlot.toISOString(),
    totalRecipients: rows.length,
    alreadyClaimed: alreadyClaimed.length,
    recipientsWithPushTokens: withTokens,
  }, null, 2));

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
