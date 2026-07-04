import { jsonb, pgEnum, pgTable, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { articlesTable } from "./articles";

export const articleQuestionStatusEnum = pgEnum("article_question_status", [
  "PENDING",
  "COMPLETED",
  "FAILED",
]);

export const articleQuestionsTable = pgTable(
  "article_questions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    articleId: uuid("article_id").notNull().references(() => articlesTable.id),
    questions: jsonb("questions").$type<string[]>(),
    status: articleQuestionStatusEnum("status").notNull().default("PENDING"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex("article_questions_article_id_unique_idx").on(t.articleId)],
);

export const insertArticleQuestionsSchema = createInsertSchema(articleQuestionsTable).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});
export type InsertArticleQuestions = z.infer<typeof insertArticleQuestionsSchema>;
export type ArticleQuestions = typeof articleQuestionsTable.$inferSelect;
export type ArticleQuestionStatus = "PENDING" | "COMPLETED" | "FAILED";
