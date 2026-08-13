import { index, integer, pgEnum, pgTable, text, timestamp, uuid, varchar } from "drizzle-orm/pg-core";

import { storedSentencesTable } from "./stored-sentences";
import { thoughtsTable } from "./thoughts";

export const widgetTypeEnum = pgEnum("widget_type", ["TYPE_1", "TYPE_2", "TYPE_3"]);

export const questionBankStatusEnum = pgEnum("question_bank_status", ["active", "consumed"]);

export const questionBankTable = pgTable(
  "question_bank",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    widgetType: widgetTypeEnum("widget_type").notNull(),
    mainContent: text("main_content").notNull(),
    subExplanation: text("sub_explanation").notNull(),
    ctaButtonText: varchar("cta_button_text", { length: 100 }).notNull(),
    mainThoughtId: uuid("main_thought_id").references(() => thoughtsTable.id),
    mainStoredSentenceId: uuid("main_stored_sentence_id").references(() => storedSentencesTable.id),
    subThoughtId: uuid("sub_thought_id").references(() => thoughtsTable.id),
    qualityScore: integer("quality_score").notNull().default(0),
    status: questionBankStatusEnum("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_question_bank_status_created_at").on(t.status, t.createdAt)],
);

export type QuestionBank = typeof questionBankTable.$inferSelect;
export type InsertQuestionBank = typeof questionBankTable.$inferInsert;
