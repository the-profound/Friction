import { bigint, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * Durable "claimed" / "successfully notified" ledger for the letter-arrived
 * push job (Task #2192).
 *
 * One row per (recipientId, deliverySlot) pair. `deliverySlot` is always one
 * of the canonical 06:00 KST delivery instants produced by
 * computeDeliverySlot() / kstDateAt6() / normalizeToKst6() in the API
 * server, so every inbox row's `visibleAt` exactly matches one of these
 * instants — direct/reply/team-collection sends and space-letter
 * reservations all quantize to the same set of slots.
 *
 * Progress is tracked by `inbox.sequence` (a global append-only counter,
 * see ./inbox.ts), never by a row count or a `created_at` timestamp:
 * inbox rows are user-deletable (an already-notified letter can be deleted
 * before a later wave lands), so a live COUNT of current inbox rows for a
 * slot is not monotonic and can silently under-report a genuinely new
 * batch. A row's `sequence` is assigned once, never reused, and unaffected
 * by later deletion of any row (including itself), so it is a safe
 * "how far has this recipient/slot been accounted for" cursor.
 *
 *   - `claimedThroughSequence` is the highest `inbox.sequence` reserved by
 *     the current (or most recently resolved) attempt for this
 *     recipient/slot.
 *   - `notifiedThroughSequence` is the highest `inbox.sequence` actually
 *     confirmed pushed.
 *   - `leaseId` identifies the specific in-flight attempt that most
 *     recently (re)claimed this row. It changes on every claim/reclaim and
 *     fences `confirmLetterNotificationSent` / `releaseLetterNotificationClaim`:
 *     a call carrying a stale `leaseId` (e.g. from a presumed-dead process
 *     that actually finishes late, after its lock went stale and a newer
 *     attempt already reclaimed the row) matches no row and is silently a
 *     no-op, so it can never confirm or release a different attempt's claim.
 *   - `lockedAt` marks an attempt as currently in flight (set when claimed,
 *     cleared back to NULL when the attempt resolves — confirmed or
 *     released).
 *
 * `claimedThroughSequence == notifiedThroughSequence` means everything
 * claimed so far has been successfully pushed — the next caller can
 * atomically claim any newly-arrived letters (sequence > notifiedThroughSequence).
 *
 * `claimedThroughSequence != notifiedThroughSequence` means there is an
 * unresolved batch. Two sub-states, both re-claimable by a later trigger
 * (with a fresh `leaseId`) so nothing is permanently stranded:
 *   - `lockedAt IS NULL` — the previous attempt's push genuinely failed to
 *     send and was released (`releaseLetterNotificationClaim`), rather than
 *     merely finding nothing to do. A later trigger for this slot retries
 *     exactly the un-pushed letters (plus anything newly arrived since).
 *   - `lockedAt` is set and still recent — another attempt is actively in
 *     flight right now and must not be claimed again until it confirms
 *     (`notifiedThroughSequence` catches up) or releases (`lockedAt`
 *     clears). Once `lockedAt` is older than `LETTER_PUSH_LOCK_STALE_MS`
 *     (../../../artifacts/api-server/src/lib/letterNotificationQuery.ts),
 *     the attempt is presumed dead (process crash before it could resolve)
 *     and becomes re-claimable too, so a lost process can never strand a
 *     recipient's push indefinitely.
 *
 * Both the 06:00 KST timer and the periodic sweep (which also proactively
 * rechecks any slot with an unresolved — released or stale-locked — row, in
 * addition to slots it just committed new inbox rows for) attempt this
 * claim before sending a push for that slot. The unique constraint plus the
 * conditional `ON CONFLICT DO UPDATE` in `claimNewLetterRecipientsForSlot`
 * makes claiming atomic, so a recipient's letters are only ever reflected
 * in one in-flight push at a time no matter how many times or in what order
 * any trigger fires.
 */
export const letterArrivalNotificationsTable = pgTable(
  "letter_arrival_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    deliverySlot: timestamp("delivery_slot", { withTimezone: true }).notNull(),
    claimedThroughSequence: bigint("claimed_through_sequence", {
      mode: "number",
    }).notNull(),
    notifiedThroughSequence: bigint("notified_through_sequence", {
      mode: "number",
    })
      .notNull()
      .default(0),
    /** Identity of the attempt currently (or most recently) holding the
     * claim; fences confirm/release against a stale attempt. */
    leaseId: uuid("lease_id"),
    /** Set while an attempt is in flight; NULL once it confirms or releases. */
    lockedAt: timestamp("locked_at", { withTimezone: true }),
    notifiedAt: timestamp("notified_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (t) => [
    unique("letter_arrival_notifications_recipient_slot_unique").on(
      t.recipientId,
      t.deliverySlot,
    ),
  ],
);

export type LetterArrivalNotification =
  typeof letterArrivalNotificationsTable.$inferSelect;
