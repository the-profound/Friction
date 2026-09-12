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
 * `claimNewLetterRecipientsForSlot` durably records a *claim* for a
 * recipient/slot before the caller attempts `sendPush`, and the caller must
 * report the outcome back via `confirmLetterNotificationSent` (push actually
 * went out) or `releaseLetterNotificationClaim` (push failed to send). This
 * separation — rather than recording "notified" at claim time — closes two
 * gaps in the original design (Task #2110):
 *
 *   1. A push that genuinely fails to send no longer permanently forfeits
 *      that recipient's notification for the slot: releasing the claim
 *      leaves it discoverable so a later trigger can retry exactly those
 *      letters.
 *   2. A second wave of inbox rows landing in a slot a recipient was already
 *      notified for is not silently absorbed: once the earlier attempt is
 *      confirmed, the next claim covers just the newly-arrived delta.
 *
 * Progress is tracked by `inbox.sequence` (a global append-only counter —
 * see @workspace/db's inbox schema), never by counting current inbox rows:
 * inbox rows are user-deletable (DELETE /api/inbox/:id), so a live COUNT for
 * a slot is not monotonic and can under-report a genuinely new batch if an
 * earlier, already-notified letter was deleted in the meantime. A row's
 * `sequence` is assigned once and never reused or affected by any row's
 * later deletion, so "claimed/notified through sequence N" is a safe
 * cursor regardless of what gets deleted afterward.
 *
 * The claim itself stays atomic and slot-exclusive per recipient: while one
 * attempt is unresolved and its lock is fresh, no other caller can claim
 * further letters for that recipient/slot, so two triggers racing each
 * other — from the 06:00 timer, from a post-delivery-sweep recheck, or the
 * periodic retry recheck below — can never both attempt to push the same
 * letters at once. Every (re)claim also mints a fresh `leaseId`, which
 * `confirmLetterNotificationSent`/`releaseLetterNotificationClaim` must
 * present back: this fences a presumed-dead attempt that actually finishes
 * late (after its lock went stale and a newer attempt already reclaimed the
 * row) from ever resolving that newer attempt's claim instead of its own.
 *
 * A released (or crashed and stale-locked) claim does not, by itself,
 * guarantee any *future* call ever happens for that exact slot — the 06:00
 * timer fires for a slot exactly once, and the delivery sweep otherwise only
 * rechecks slots it just committed new reservation rows for.
 * `findDeliverySlotsNeedingLetterPushRetry` closes that gap: it is queried
 * on every periodic sweep tick and returns every slot with an unresolved row
 * (released, or locked past `LETTER_PUSH_LOCK_STALE_MS`), so the scheduler
 * can recheck those slots too, even when nothing new has arrived for them.
 */
import { db, inboxTable, pushTokensTable, usersTable } from "@workspace/db";
import { eq, sql } from "drizzle-orm";

export interface LetterRecipient {
  userId: string;
  nickname: string;
  /** Count of newly-claimed letters this push should report — the delta
   * since this recipient's last confirmed notification for the slot, not
   * necessarily their full inbox total for it. */
  newLetterCount: number;
  /** Identity of this specific claim attempt. Pass this through unchanged
   * to `confirmLetterNotificationSent` or `releaseLetterNotificationClaim`
   * once the push attempt resolves — it is how the ledger tells this
   * attempt apart from any attempt that reclaims the same recipient/slot
   * later. */
  leaseId: string;
  /** The inbox.sequence cursor claimed up to by this attempt. Pass this
   * through unchanged to `confirmLetterNotificationSent` too. */
  claimedThroughSequence: number;
  pushTokens: { token: string; platform: string }[];
}

interface InboxSequenceRow {
  recipientId: string;
  nickname: string;
  sequence: number;
  [key: string]: unknown;
}

interface ClaimedRow {
  recipient_id: string;
  lease_id: string;
  claimed_through_sequence: number;
  notified_through_sequence: number;
  [key: string]: unknown;
}

interface RetrySlotRow {
  delivery_slot: Date;
  [key: string]: unknown;
}

/**
 * An in-flight claim (`lockedAt` set) older than this is presumed dead — the
 * process handling it crashed or was killed before it could confirm or
 * release — and becomes eligible for a fresh claim by a later trigger,
 * instead of permanently blocking that recipient/slot.
 *
 * Chosen well above the time a single `sendPush` call is expected to take,
 * and comfortably below the 5-minute periodic sweep interval that both
 * drives retries and would otherwise re-observe the same stale lock
 * repeatedly.
 */
export const LETTER_PUSH_LOCK_STALE_MS = 2 * 60 * 1000;

/**
 * Finds users with ≥1 inbox entry whose `visible_at` exactly equals
 * `deliverySlot`, atomically claims the delta between each one's current
 * max `inbox.sequence` for the slot and their last confirmed-notified
 * sequence, and returns only the recipients with a non-empty delta newly
 * claimed by this call (each including their push tokens).
 *
 * A recipient with no new delta to claim — either because they have already
 * been notified up through their current max sequence, or because another
 * caller's claim for them is still actively in flight — is silently
 * excluded from the result, so the caller's "send a push" step is safe to
 * invoke unconditionally on whatever this returns. The caller MUST report
 * the outcome of each push attempt via `confirmLetterNotificationSent` or
 * `releaseLetterNotificationClaim`, passing back the returned `leaseId` and
 * `claimedThroughSequence`, so the ledger can either advance or become
 * re-claimable.
 */
export async function claimNewLetterRecipientsForSlot(
  deliverySlot: Date,
): Promise<LetterRecipient[]> {
  const inboxRows = await db
    .select({
      recipientId: inboxTable.recipientId,
      nickname: usersTable.nickname,
      sequence: inboxTable.sequence,
    })
    .from(inboxTable)
    .innerJoin(usersTable, sql`${usersTable.id} = ${inboxTable.recipientId}`)
    .where(eq(inboxTable.visibleAt, deliverySlot));

  if (inboxRows.length === 0) return [];

  const byRecipient = new Map<
    string,
    { nickname: string; sequences: number[] }
  >();
  for (const row of inboxRows as InboxSequenceRow[]) {
    const existing = byRecipient.get(row.recipientId);
    if (existing) {
      existing.sequences.push(row.sequence);
    } else {
      byRecipient.set(row.recipientId, {
        nickname: row.nickname,
        sequences: [row.sequence],
      });
    }
  }

  const candidates = Array.from(byRecipient.entries()).map(
    ([recipientId, v]) => ({
      recipientId,
      nickname: v.nickname,
      maxSequence: Math.max(...v.sequences),
    }),
  );

  // Atomically claim, for every candidate recipient, up through the highest
  // `inbox.sequence` currently visible for this slot:
  //   - A brand-new recipient inserts with notified_through_sequence
  //     defaulting to 0, claiming their entire current backlog for a first
  //     push.
  //   - An existing recipient with no attempt in flight
  //     (claimed_through_sequence == notified_through_sequence) re-claims up
  //     to the newest sequence — covering any letters that arrived since the
  //     last confirmed push.
  //   - An existing recipient whose previous attempt was released
  //     (claimed_through_sequence != notified_through_sequence, locked_at IS
  //     NULL) or whose lock has gone stale (locked_at older than
  //     LETTER_PUSH_LOCK_STALE_MS) is also re-claimable — this retries the
  //     un-pushed batch, folding in any letters that arrived since, in a
  //     single fresh attempt with a brand-new lease.
  //   - An existing recipient with a fresh in-flight lock is excluded from
  //     the update — whichever caller is mid-attempt keeps the exclusive
  //     claim until it confirms or releases, so two triggers can never send
  //     overlapping pushes for the same letters at once.
  //   - An existing recipient already notified up to the current max
  //     sequence is also excluded — there is nothing new to claim.
  const values = sql.join(
    candidates.map(
      (c) =>
        sql`(${c.recipientId}::uuid, ${deliverySlot}::timestamptz, ${c.maxSequence}::bigint, 0, gen_random_uuid(), now())`,
    ),
    sql`, `,
  );

  const claimed = await db.execute<ClaimedRow>(sql`
    INSERT INTO letter_arrival_notifications
      (recipient_id, delivery_slot, claimed_through_sequence, notified_through_sequence, lease_id, locked_at)
    VALUES ${values}
    ON CONFLICT (recipient_id, delivery_slot) DO UPDATE
      SET claimed_through_sequence = EXCLUDED.claimed_through_sequence,
          lease_id = gen_random_uuid(),
          locked_at = now()
      WHERE letter_arrival_notifications.notified_through_sequence < EXCLUDED.claimed_through_sequence
        AND (
          letter_arrival_notifications.claimed_through_sequence = letter_arrival_notifications.notified_through_sequence
          OR letter_arrival_notifications.locked_at IS NULL
          OR letter_arrival_notifications.locked_at < now() - (${LETTER_PUSH_LOCK_STALE_MS}::int * interval '1 millisecond')
        )
    RETURNING recipient_id, lease_id, claimed_through_sequence, notified_through_sequence
  `);

  if (claimed.rows.length === 0) return [];

  const claimedByUserId = new Map<string, ClaimedRow>(
    claimed.rows.map((c) => [c.recipient_id, c]),
  );

  const userIds = Array.from(claimedByUserId.keys());
  const tokenRows = await db
    .select({
      userId: pushTokensTable.userId,
      token: pushTokensTable.token,
      platform: pushTokensTable.platform,
    })
    .from(pushTokensTable)
    .where(sql`${pushTokensTable.userId} = ANY(${userIds})`);

  const tokensByUser = new Map<string, { token: string; platform: string }[]>();
  for (const t of tokenRows as {
    userId: string;
    token: string;
    platform: string;
  }[]) {
    if (!tokensByUser.has(t.userId)) tokensByUser.set(t.userId, []);
    tokensByUser.get(t.userId)!.push({ token: t.token, platform: t.platform });
  }

  const result: LetterRecipient[] = [];
  for (const candidate of candidates) {
    const claim = claimedByUserId.get(candidate.recipientId);
    if (!claim) continue;
    // The delta claimed by *this* attempt is exactly the sequences fetched
    // above (all <= candidate.maxSequence == claim.claimed_through_sequence
    // by construction) that are newer than what was already confirmed —
    // never a raw count of current rows, so a deletion of an
    // already-notified row can't mask this delta.
    const newLetterCount = byRecipient
      .get(candidate.recipientId)!
      .sequences.filter((s) => s > claim.notified_through_sequence).length;
    result.push({
      userId: candidate.recipientId,
      nickname: candidate.nickname,
      newLetterCount,
      leaseId: claim.lease_id,
      claimedThroughSequence: claim.claimed_through_sequence,
      pushTokens: tokensByUser.get(candidate.recipientId) ?? [],
    });
  }
  return result;
}

/**
 * Confirms that a push was successfully sent covering everything claimed up
 * to `claimedThroughSequence`, advancing `notified_through_sequence` to
 * match and clearing the lock. Guarded on `lease_id` still equalling
 * `leaseId` — the identity of the specific claim attempt that is
 * confirming — so a stale/duplicate confirmation from an attempt that has
 * since been superseded by a fresh reclaim can never overwrite that newer
 * attempt's state.
 */
export async function confirmLetterNotificationSent(
  recipientId: string,
  deliverySlot: Date,
  leaseId: string,
  claimedThroughSequence: number,
): Promise<void> {
  await db.execute(sql`
    UPDATE letter_arrival_notifications
    SET notified_through_sequence = ${claimedThroughSequence}, locked_at = NULL, notified_at = now()
    WHERE recipient_id = ${recipientId}
      AND delivery_slot = ${deliverySlot}
      AND lease_id = ${leaseId}
  `);
}

/**
 * Releases a claim whose push attempt failed to send, clearing the lock
 * while leaving `claimed_through_sequence` ahead of
 * `notified_through_sequence` so the row stays discoverable — by a fresh
 * claim attempt, and by `findDeliverySlotsNeedingLetterPushRetry` — until a
 * later trigger successfully retries exactly the letters that were never
 * pushed. Guarded on `lease_id` still equalling `leaseId` so a
 * stale/duplicate release can never clobber a newer attempt's state (e.g.
 * clearing a fresh reclaim's lock out from under it).
 */
export async function releaseLetterNotificationClaim(
  recipientId: string,
  deliverySlot: Date,
  leaseId: string,
): Promise<void> {
  await db.execute(sql`
    UPDATE letter_arrival_notifications
    SET locked_at = NULL
    WHERE recipient_id = ${recipientId}
      AND delivery_slot = ${deliverySlot}
      AND lease_id = ${leaseId}
  `);
}

/**
 * Returns every delivery slot with at least one unresolved row — released
 * (`locked_at IS NULL`) or stuck behind a stale lock
 * (`locked_at` older than `LETTER_PUSH_LOCK_STALE_MS`, meaning the process
 * handling it is presumed dead — so the scheduler can proactively recheck
 * those slots even when no new reservation activity would otherwise trigger
 * a recheck. This is what makes a released or crashed claim actually get
 * retried in production, rather than merely eligible for a retry that never
 * comes.
 */
export async function findDeliverySlotsNeedingLetterPushRetry(): Promise<Date[]> {
  const result = await db.execute<RetrySlotRow>(sql`
    SELECT DISTINCT delivery_slot
    FROM letter_arrival_notifications
    WHERE claimed_through_sequence <> notified_through_sequence
      AND (
        locked_at IS NULL
        OR locked_at < now() - (${LETTER_PUSH_LOCK_STALE_MS}::int * interval '1 millisecond')
      )
  `);
  return result.rows.map((r) => new Date(r.delivery_slot));
}
