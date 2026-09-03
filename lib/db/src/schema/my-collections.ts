import { sql } from "drizzle-orm";
import { boolean, index, pgTable, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { articlesTable } from "./articles";
import { usersTable } from "./users";

export const myCollectionsTable = pgTable("my_collections", {
  id: uuid("id").defaultRandom().primaryKey(),
  ownerId: uuid("owner_id").notNull().references(() => usersTable.id),
  name: varchar("name", { length: 30 }).notNull(),
  description: text("description"),
  isPublic: boolean("is_public").notNull().default(false),
  isArchive: boolean("is_archive").notNull().default(false),
  isImpression: boolean("is_impression").notNull().default(false),
  coverImageUrl: text("cover_image_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("my_collections_owner_name_unique").on(t.ownerId, t.name),
  uniqueIndex("my_collections_owner_archive_unique").on(t.ownerId).where(sql`${t.isArchive} = true`),
  uniqueIndex("my_collections_owner_impression_unique").on(t.ownerId).where(sql`${t.isImpression} = true`),
]);

export const insertMyCollectionSchema = createInsertSchema(myCollectionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertMyCollection = z.infer<typeof insertMyCollectionSchema>;
export type MyCollection = typeof myCollectionsTable.$inferSelect;

export const myCollectionArticlesTable = pgTable("my_collection_articles", {
  id: uuid("id").defaultRandom().primaryKey(),
  myCollectionId: uuid("my_collection_id").notNull().references(() => myCollectionsTable.id),
  articleId: uuid("article_id").notNull().references(() => articlesTable.id),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("my_collection_articles_unique").on(t.myCollectionId, t.articleId),
  index("my_collection_articles_article_added_idx").on(t.articleId, t.addedAt),
]);

export const insertMyCollectionArticleSchema = createInsertSchema(myCollectionArticlesTable).omit({ id: true });
export type InsertMyCollectionArticle = z.infer<typeof insertMyCollectionArticleSchema>;
export type MyCollectionArticle = typeof myCollectionArticlesTable.$inferSelect;
