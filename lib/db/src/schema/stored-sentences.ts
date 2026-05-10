import { boolean, jsonb, pgTable, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { articlesTable } from "./articles";
import { usersTable } from "./users";

export const storedSentencesTable = pgTable("stored_sentences", {
  id: uuid("id").defaultRandom().primaryKey(),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  articleId: uuid("article_id").notNull().references(() => articlesTable.id),
  text: text("text").notNull(),
  position: jsonb("position"),
  isFavorite: boolean("is_favorite").notNull().default(false),
  favoritedAt: timestamp("favorited_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertStoredSentenceSchema = createInsertSchema(storedSentencesTable).omit({ id: true, createdAt: true });
export type InsertStoredSentence = z.infer<typeof insertStoredSentenceSchema>;
export type StoredSentence = typeof storedSentencesTable.$inferSelect;
