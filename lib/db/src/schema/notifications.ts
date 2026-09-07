import { integer, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

/**
 * Durable "already notified" marker for the letter-arrived push job.
 *
 * One row per (recipientId, deliverySlot) pair. `deliverySlot` is always one
 * of the canonical 06:00 KST delivery instants produced by
 * computeDeliverySlot() / kstDateAt6() / normalizeToKst6() in the API
 * server, so every inbox row's `visibleAt` exactly matches one of these
 * instants — direct/reply/team-collection sends and space-letter
 * reservations all quantize to the same set of slots.
 *
 * Both the 06:00 KST timer and the post-delivery-sweep recheck (run right
 * after `processDueScheduledSends` commits inbox rows for a slot) attempt to
 * claim a row here before sending a push for that slot. The unique
 * constraint plus `onConflictDoNothing` makes claiming atomic, so a
 * recipient is notified for a given delivery slot at most once no matter how
 * many times or in what order either trigger fires.
 */
export const letterArrivalNotificationsTable = pgTable(
  "letter_arrival_notifications",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    recipientId: uuid("recipient_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    deliverySlot: timestamp("delivery_slot", { withTimezone: true }).notNull(),
    letterCount: integer("letter_count").notNull(),
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
