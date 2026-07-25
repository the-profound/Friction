import { customType, integer, jsonb, pgEnum, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";

import { articlesTable } from "./articles";
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

export const thoughtPromotionTypeEnum = pgEnum("thought_promotion_type", [
  "promote",
  "cite",
]);

export const thoughtsTable = pgTable("thoughts", {
  id: uuid("id").defaultRandom().primaryKey(),
  authorId: uuid("author_id").notNull().references(() => usersTable.id),
  content: text("content"),
  sourceArticleId: uuid("source_article_id").references(() => articlesTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  recommendedAtWidget: timestamp("recommended_at_widget", { withTimezone: true }),
  recommendedTimesWidget: integer("recommended_times_widget").notNull().default(0),
  textEmbeddingDense: vector("text_embedding_dense", 1024),
  textEmbeddingSparse: jsonb("text_embedding_sparse").$type<Record<string, number>>(),
  createdFrom: thoughtCreatedFromEnum("created_from").notNull(),
});

export const thoughtPromotionsTable = pgTable("thought_promotions", {
  id: uuid("id").defaultRandom().primaryKey(),
  fromThoughtId: uuid("from_thought_id").notNull().references(() => thoughtsTable.id),
  toDraftId: uuid("to_draft_id").notNull().references(() => articlesTable.id),
  promotionType: thoughtPromotionTypeEnum("promotion_type").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Thought = typeof thoughtsTable.$inferSelect;
export type InsertThought = typeof thoughtsTable.$inferInsert;
export type ThoughtPromotion = typeof thoughtPromotionsTable.$inferSelect;
export type InsertThoughtPromotion = typeof thoughtPromotionsTable.$inferInsert;
export type ThoughtCreatedFrom = "quoted" | "question" | "reading" | "direct";
export type ThoughtPromotionType = "promote" | "cite";
