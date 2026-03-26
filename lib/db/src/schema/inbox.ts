import { boolean, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { articlesTable } from "./articles";
import { usersTable } from "./users";

export const inboxTable = pgTable("inbox", {
  id: uuid("id").defaultRandom().primaryKey(),
  recipientId: uuid("recipient_id").notNull().references(() => usersTable.id),
  articleId: uuid("article_id").notNull().references(() => articlesTable.id),
  senderId: uuid("sender_id").notNull().references(() => usersTable.id),
  visibleAt: timestamp("visible_at", { withTimezone: true }).notNull(),
  openedAt: timestamp("opened_at", { withTimezone: true }),
  isRead: boolean("is_read").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertInboxSchema = createInsertSchema(inboxTable).omit({ id: true, createdAt: true });
export type InsertInbox = z.infer<typeof insertInboxSchema>;
export type Inbox = typeof inboxTable.$inferSelect;
