import { pgEnum, pgTable, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { articlesTable } from "./articles";
import { inboxTable } from "./inbox";
import { teamCollectionsTable } from "./team-collections";
import { usersTable } from "./users";

export const sendRecordTargetTypeEnum = pgEnum("send_record_target_type", ["person", "group"]);

export const sendRecordsTable = pgTable("send_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  senderId: uuid("sender_id").notNull().references(() => usersTable.id),
  recipientId: uuid("recipient_id").references(() => usersTable.id),
  articleId: uuid("article_id").notNull().references(() => articlesTable.id),
  inboxId: uuid("inbox_id").references(() => inboxTable.id),
  teamCollectionId: uuid("team_collection_id").references(() => teamCollectionsTable.id),
  targetType: sendRecordTargetTypeEnum("target_type").notNull().default("person"),
  deliverySlot: timestamp("delivery_slot", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSendRecordSchema = createInsertSchema(sendRecordsTable).omit({ id: true });
export type InsertSendRecord = z.infer<typeof insertSendRecordSchema>;
export type SendRecord = typeof sendRecordsTable.$inferSelect;
