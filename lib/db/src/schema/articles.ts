import { jsonb, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { usersTable } from "./users";

export const articleStatusEnum = pgEnum("article_status", ["DRAFT", "DIVIDING", "CLOSING", "LETTER"]);

export const articlesTable = pgTable("articles", {
  id: uuid("id").defaultRandom().primaryKey(),
  authorId: uuid("author_id").notNull().references(() => usersTable.id),
  title: varchar("title", { length: 500 }).notNull(),
  content: text("content").notNull(),
  status: articleStatusEnum("status").notNull().default("DRAFT"),
  pages: jsonb("pages"),
  style: jsonb("style"),
  cover: jsonb("cover"),
  letterAt: timestamp("letter_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertArticleSchema = createInsertSchema(articlesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertArticle = z.infer<typeof insertArticleSchema>;
export type Article = typeof articlesTable.$inferSelect;
export type ArticleStatus = "DRAFT" | "DIVIDING" | "CLOSING" | "LETTER";
