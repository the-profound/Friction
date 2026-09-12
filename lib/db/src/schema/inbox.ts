import { sql } from "drizzle-orm";
import { bigserial, boolean, pgTable, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { articlesTable } from "./articles";
import { spacesTable, spaceScheduledSendsTable } from "./spaces";
import { teamCollectionsTable } from "./team-collections";
import { usersTable } from "./users";

export const inboxTable = pgTable("inbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  recipientId: uuid("recipient_id").notNull().references(() => usersTable.id),
  articleId: uuid("article_id").notNull().references(() => articlesTable.id),
  senderId: uuid("sender_id").notNull().references(() => usersTable.id),
  sourceTeamCollectionId: uuid("source_team_collection_id").references(
    () => teamCollectionsTable.id,
    { onDelete: "set null" },
  ),
  sourceSpaceId: uuid("source_space_id").references(
    () => spacesTable.id,
    { onDelete: "set null" },
  ),
  sourceSpaceScheduledSendId: uuid("source_space_scheduled_send_id").references(
    () => spaceScheduledSendsTable.id,
    { onDelete: "set null" },
  ),
  visibleAt: timestamp("visible_at", { withTimezone: true }).notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  isRead: boolean("is_read").notNull().default(false),
  isEnvelope: boolean("is_envelope").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  /**
   * Global append-only ordering identity (Task #2192), independent of
   * `created_at` (which is transaction-time and can tie across a bulk
   * insert) and unaffected by later hard-deletion of any row — a row's
   * `sequence` never gets reused or renumbered once assigned, so it is
   * safe to use as a durable "has this inbox row already been accounted
   * for" cursor (e.g. in the letter-arrived push notification ledger) even
   * after other rows for the same recipient/slot are deleted.
   */
  sequence: bigserial("sequence", { mode: "number" }).notNull(),
}, (t) => [
  unique("inbox_recipient_article_sources_unique")
    .on(
      t.recipientId,
      t.articleId,
      t.sourceTeamCollectionId,
      t.sourceSpaceScheduledSendId,
    )
    .nullsNotDistinct(),
  uniqueIndex("inbox_space_scheduled_send_recipient_unique")
    .on(t.recipientId, t.sourceSpaceScheduledSendId)
    .where(sql`${t.sourceSpaceScheduledSendId} IS NOT NULL`),
]);

export const insertInboxSchema = createInsertSchema(inboxTable).omit({ id: true, createdAt: true });
export type InsertInbox = z.infer<typeof insertInboxSchema>;
export type Inbox = typeof inboxTable.$inferSelect;
