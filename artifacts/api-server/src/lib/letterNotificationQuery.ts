/**
 * Query helpers for the letter-arrived notification job.
 *
 * Recipients are aggregated per *exact* delivery slot (a canonical 06:00 KST
 * instant — see computeDeliverySlot()/kstDateAt6()/normalizeToKst6() in
 * ../lib/deliverySlot.ts) rather than a rolling time window. Every inbox row
 * (direct sends, replies, team-collection sends, and space-letter
 * reservations delivered via scheduledSendProcessor) has its `visibleAt` set
 * to one of these exact instants, so an exact match cannot mis-bucket a
 * letter across a day boundary the way a "last N hours" window can.
 *
 * `claimNewLetterRecipientsForSlot` also durably records that a recipient
 * has been notified for a given slot before returning them, so calling it
 * more than once for the same slot — from the 06:00 timer, from a
 * post-delivery-sweep recheck, or both racing each other — can only notify
 * each recipient once.
 */
import {
  db,
  inboxTable,
  letterArrivalNotificationsTable,
  pushTokensTable,
  usersTable,
} from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export interface LetterRecipient {
  userId: string;
  nickname: string;
  newLetterCount: number;
  pushTokens: { token: string; platform: string }[];
}

/**
 * Finds users with ≥1 inbox entry whose `visible_at` exactly equals
 * `deliverySlot`, atomically claims each one in
 * `letter_arrival_notifications`, and returns only the recipients newly
 * claimed by this call (each including their push tokens).
 *
 * A recipient already claimed for this slot — by an earlier call in this
 * process or a previous one — is silently excluded from the result, so the
 * caller's "send a push" step is safe to invoke unconditionally on whatever
 * this returns.
 */
export async function claimNewLetterRecipientsForSlot(
  deliverySlot: Date,
): Promise<LetterRecipient[]> {
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

  if (rows.length === 0) return [];

  // Atomically claim every candidate recipient for this slot. Only rows
  // that actually insert (no prior claim exists) come back — a concurrent
  // or later caller that lost the race for a given recipient gets nothing
  // for them here, guaranteeing at-most-once notification per recipient per
  // slot regardless of how this function is invoked.
  const claimed = await db
    .insert(letterArrivalNotificationsTable)
    .values(
      rows.map((r: { userId: string; newLetterCount: number }) => ({
        recipientId: r.userId,
        deliverySlot,
        letterCount: r.newLetterCount,
      })),
    )
    .onConflictDoNothing({
      target: [
        letterArrivalNotificationsTable.recipientId,
        letterArrivalNotificationsTable.deliverySlot,
      ],
    })
    .returning({ recipientId: letterArrivalNotificationsTable.recipientId });

  if (claimed.length === 0) return [];

  const claimedIds = new Set(
    claimed.map((c: { recipientId: string }) => c.recipientId),
  );
  const claimedRows = rows.filter((r: { userId: string }) =>
    claimedIds.has(r.userId),
  );

  const userIds = claimedRows.map((r: { userId: string }) => r.userId);
  const tokenRows = await db
    .select({
      userId: pushTokensTable.userId,
      token: pushTokensTable.token,
      platform: pushTokensTable.platform,
    })
    .from(pushTokensTable)
    .where(sql`${pushTokensTable.userId} = ANY(${userIds})`);

  const tokensByUser = new Map<string, { token: string; platform: string }[]>();
  for (const t of tokenRows) {
    if (!tokensByUser.has(t.userId)) tokensByUser.set(t.userId, []);
    tokensByUser.get(t.userId)!.push({ token: t.token, platform: t.platform });
  }

  return claimedRows.map(
    (r: { userId: string; nickname: string; newLetterCount: number }) => ({
      userId: r.userId,
      nickname: r.nickname,
      newLetterCount: r.newLetterCount,
      pushTokens: tokensByUser.get(r.userId) ?? [],
    }),
  );
}
