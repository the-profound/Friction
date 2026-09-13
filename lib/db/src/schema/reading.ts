import { bigint, integer, pgTable, real, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { articlesTable } from "./articles";
import { usersTable } from "./users";

export const userArticleReadsTable = pgTable("user_article_reads", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  articleId: uuid("article_id").notNull().references(() => articlesTable.id),
  completedAt: timestamp("completed_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("user_article_reads_unique").on(t.userId, t.articleId),
]);

export const insertUserArticleReadSchema = createInsertSchema(userArticleReadsTable).omit({ id: true });
export type InsertUserArticleRead = z.infer<typeof insertUserArticleReadSchema>;
export type UserArticleRead = typeof userArticleReadsTable.$inferSelect;

export const readingRecordsTable = pgTable("reading_records", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  articleId: uuid("article_id").notNull().references(() => articlesTable.id),
  currentPage: integer("current_page").notNull().default(0),
  scrollPosition: real("scroll_position").notNull().default(0),
  saveRevision: bigint("save_revision", { mode: "number" }).notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("reading_records_unique").on(t.userId, t.articleId),
]);

export const insertReadingRecordSchema = createInsertSchema(readingRecordsTable).omit({ id: true });
export type InsertReadingRecord = z.infer<typeof insertReadingRecordSchema>;
export type ReadingRecord = typeof readingRecordsTable.$inferSelect;
