import { customType, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid, uniqueIndex, check } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { articlesTable } from "./articles";
import { storedSentencesTable } from "./stored-sentences";
import { usersTable } from "./users";

const vector = (name: string, dimensions: number) =>
  customType<{ data: number[] }>({
    dataType() {
      return `vector(${dimensions})`;
    },
    toDriver(value: number[]) {
      return `[${value.join(",")}]`;
    },
    fromDriver(value: unknown) {
      if (typeof value === "string") {
        return value
          .slice(1, -1)
          .split(",")
          .map(Number);
      }
      return value as number[];
    },
  })(name);

export const thoughtCreatedFromEnum = pgEnum("thought_created_from", [
  "quoted",
  "question",
  "reading",
  "direct",
]);

export const thoughtStatusEnum = pgEnum("thought_status", [
  "NORMAL",
  "PRELIMINARY",
]);

export const thoughtPromotionTypeEnum = pgEnum("thought_promotion_type", [
  "promote",
  "cite",
]);

export const thoughtsTable = pgTable("thoughts", {
  id: uuid("id").defaultRandom().primaryKey(),
  authorId: uuid("author_id").notNull().references(() => usersTable.id),
  content: text("content").notNull(),
  sourceArticleId: uuid("source_article_id").references(() => articlesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  status: thoughtStatusEnum("status").notNull().default("NORMAL"),
  migratedFromArticleId: uuid("migrated_from_article_id").references(() => articlesTable.id),
  sourceStoredSentenceId: uuid("source_stored_sentence_id").references(() => storedSentencesTable.id),
  textEmbeddingDense: vector("text_embedding_dense", 1024),
  textEmbeddingSparse: jsonb("text_embedding_sparse").$type<Record<string, number>>(),
  createdFrom: thoughtCreatedFromEnum("created_from").notNull(),
}, (t) => [
  uniqueIndex("thoughts_migrated_from_article_unique_idx")
    .on(t.migratedFromArticleId)
    .where(sql`${t.migratedFromArticleId} IS NOT NULL`),
    uniqueIndex("thoughts_writing_source_unique_idx")
      .on(t.authorId, t.sourceArticleId)
      .where(sql`${t.sourceArticleId} IS NOT NULL AND (${t.status} = 'PRELIMINARY' OR ${t.migratedFromArticleId} IS NOT NULL)`),
    check(
      "thoughts_content_meaningful_check",
      sql`length(regexp_replace(regexp_replace(${t.content}, '!\\[[^]]*\\]\\([^)]*\\)?', '', 'g'), '[[:space:]#*_~\`>|[\](){},.!+\-=]', '', 'g')) > 0
        OR ${t.content} ~ '!\\[[^]]*\\]\\([[:space:]]*[^)[:space:]][^)]*\\)'`,
    ),
]);

export const thoughtPromotionsTable = pgTable("thought_promotions", {
  id: uuid("id").defaultRandom().primaryKey(),
  fromThoughtId: uuid("from_thought_id").notNull().references(() => thoughtsTable.id),
  toDraftId: uuid("to_draft_id").notNull().references(() => articlesTable.id),
  promotionType: thoughtPromotionTypeEnum("promotion_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("thought_promotions_from_thought_unique_idx").on(t.fromThoughtId),
]);

/**
 * Immutable provenance for a generated question. A question may be based on
 * several thoughts, quotes, and source articles; keeping these as rows rather
 * than copying them into the question makes promotion preserve its context.
 */
export const thoughtQuestionSourcesTable = pgTable("thought_question_sources", {
  id: uuid("id").defaultRandom().primaryKey(),
  questionThoughtId: uuid("question_thought_id").notNull().references(() => thoughtsTable.id),
  sourceThoughtId: uuid("source_thought_id").references(() => thoughtsTable.id),
  sourceStoredSentenceId: uuid("source_stored_sentence_id").references(() => storedSentencesTable.id),
  sourceArticleId: uuid("source_article_id").references(() => articlesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("thought_question_sources_unique_idx").on(
    t.questionThoughtId,
    t.sourceThoughtId,
    t.sourceStoredSentenceId,
    t.sourceArticleId,
  ),
  check(
    "thought_question_sources_one_source_check",
    sql`num_nonnulls(${t.sourceThoughtId}, ${t.sourceStoredSentenceId}, ${t.sourceArticleId}) = 1`,
  ),
]);

/**
 * FIFO order is owned by the server, not by the client. Positions are
 * compacted transactionally whenever a question is appended or requeued.
 */
export const thoughtQuestionQueueTable = pgTable("thought_question_queue", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  thoughtId: uuid("thought_id").notNull().references(() => thoughtsTable.id),
  position: integer("position").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  uniqueIndex("thought_question_queue_user_thought_unique_idx").on(t.userId, t.thoughtId),
  uniqueIndex("thought_question_queue_user_position_unique_idx").on(t.userId, t.position),
]);

export type Thought = typeof thoughtsTable.$inferSelect;
export type InsertThought = typeof thoughtsTable.$inferInsert;
export type ThoughtPromotion = typeof thoughtPromotionsTable.$inferSelect;
export type InsertThoughtPromotion = typeof thoughtPromotionsTable.$inferInsert;
export type ThoughtQuestionSource = typeof thoughtQuestionSourcesTable.$inferSelect;
export type InsertThoughtQuestionSource = typeof thoughtQuestionSourcesTable.$inferInsert;
export type ThoughtQuestionQueue = typeof thoughtQuestionQueueTable.$inferSelect;
export type InsertThoughtQuestionQueue = typeof thoughtQuestionQueueTable.$inferInsert;
export type ThoughtCreatedFrom = "quoted" | "question" | "reading" | "direct";
export type ThoughtStatus = "NORMAL" | "PRELIMINARY";
export type ThoughtPromotionType = "promote" | "cite";
