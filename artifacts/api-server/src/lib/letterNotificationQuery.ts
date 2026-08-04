/**
 * Query helpers for the letter-arrived notification job.
 *
 * Finds recipients who received at least one new letter in the past
 * `windowHours` hours, joining their nickname and push tokens.
 */
import { db, inboxTable, usersTable, pushTokensTable } from "@workspace/db";
import { and, gte, lte, sql } from "drizzle-orm";

export interface LetterRecipient {
  userId: string;
  nickname: string;
  newLetterCount: number;
  pushTokens: { token: string; platform: string }[];
}

/**
 * Returns users who have at least one inbox entry with
 * `visible_at` within the past `windowHours` hours.
 * Each result includes their push tokens.
 */
export async function getNewLetterRecipients(
  windowHours: number,
): Promise<LetterRecipient[]> {
  const now = new Date();
  const cutoff = new Date(now.getTime() - windowHours * 60 * 60 * 1000);

  // Only letters that have already become visible (visible_at <= now) AND
  // arrived within the past windowHours (visible_at >= cutoff).
  // This excludes letters scheduled for the future.
  const rows = await db
    .select({
      userId: usersTable.id,
      nickname: usersTable.nickname,
      newLetterCount: sql<number>`cast(count(${inboxTable.id}) as int)`,
    })
    .from(inboxTable)
    .innerJoin(usersTable, sql`${usersTable.id} = ${inboxTable.recipientId}`)
    .where(and(gte(inboxTable.visibleAt, cutoff), lte(inboxTable.visibleAt, now)))
    .groupBy(usersTable.id, usersTable.nickname);

  if (rows.length === 0) return [];

  // Fetch push tokens for the matched users
  const userIds = rows.map((r: { userId: string }) => r.userId);
  const tokenRows = await db
    .select({
      userId: pushTokensTable.userId,
      token: pushTokensTable.token,
      platform: pushTokensTable.platform,
    })
    .from(pushTokensTable)
    .where(sql`${pushTokensTable.userId} = ANY(${userIds})`);

  // Group tokens by userId
  const tokensByUser = new Map<string, { token: string; platform: string }[]>();
  for (const t of tokenRows) {
    if (!tokensByUser.has(t.userId)) tokensByUser.set(t.userId, []);
    tokensByUser.get(t.userId)!.push({ token: t.token, platform: t.platform });
  }

  return rows.map((r: { userId: string; nickname: string; newLetterCount: number }) => ({
    userId: r.userId,
    nickname: r.nickname,
    newLetterCount: r.newLetterCount,
    pushTokens: tokensByUser.get(r.userId) ?? [],
  }));
}
