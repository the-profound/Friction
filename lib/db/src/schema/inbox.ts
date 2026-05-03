import { boolean, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { articlesTable } from "./articles";
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
  visibleAt: timestamp("visible_at", { withTimezone: true }).notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("inbox_recipient_article_source_unique")
    .on(t.recipientId, t.articleId, t.sourceTeamCollectionId)
    .nullsNotDistinct(),
]);

export const insertInboxSchema = createInsertSchema(inboxTable).omit({ id: true, createdAt: true });
export type InsertInbox = z.infer<typeof insertInboxSchema>;
export type Inbox = typeof inboxTable.$inferSelect;
