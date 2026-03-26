import { pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { articlesTable } from "./articles";
import { inboxTable } from "./inbox";
import { usersTable } from "./users";

export const sendRecordsTable = pgTable("send_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  senderId: uuid("sender_id").notNull().references(() => usersTable.id),
  recipientId: uuid("recipient_id").notNull().references(() => usersTable.id),
  articleId: uuid("article_id").notNull().references(() => articlesTable.id),
  inboxId: uuid("inbox_id").notNull().references(() => inboxTable.id),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSendRecordSchema = createInsertSchema(sendRecordsTable).omit({ id: true });
export type InsertSendRecord = z.infer<typeof insertSendRecordSchema>;
export type SendRecord = typeof sendRecordsTable.$inferSelect;
