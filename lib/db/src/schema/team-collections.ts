import { pgEnum, pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { articlesTable } from "./articles";
import { usersTable } from "./users";

export const teamCollectionsTable = pgTable("team_collections", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 30 }).notNull(),
  description: text("description"),
  creatorId: uuid("creator_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertTeamCollectionSchema = createInsertSchema(teamCollectionsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertTeamCollection = z.infer<typeof insertTeamCollectionSchema>;
export type TeamCollection = typeof teamCollectionsTable.$inferSelect;

export const teamMemberRoleEnum = pgEnum("team_member_role", ["OWNER", "MEMBER"]);

export const teamCollectionMembershipsTable = pgTable("team_collection_memberships", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamCollectionId: uuid("team_collection_id").notNull().references(() => teamCollectionsTable.id),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  role: teamMemberRoleEnum("role").notNull(),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("team_collection_memberships_unique").on(t.teamCollectionId, t.userId),
]);

export const insertTeamCollectionMembershipSchema = createInsertSchema(teamCollectionMembershipsTable).omit({ id: true });
export type InsertTeamCollectionMembership = z.infer<typeof insertTeamCollectionMembershipSchema>;
export type TeamCollectionMembership = typeof teamCollectionMembershipsTable.$inferSelect;

export const teamCollectionArticlesTable = pgTable("team_collection_articles", {
  id: uuid("id").defaultRandom().primaryKey(),
  teamCollectionId: uuid("team_collection_id").notNull().references(() => teamCollectionsTable.id),
  articleId: uuid("article_id").notNull().references(() => articlesTable.id),
  addedBy: uuid("added_by").notNull().references(() => usersTable.id),
  addedAt: timestamp("added_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("team_collection_articles_unique").on(t.teamCollectionId, t.articleId),
]);

export const insertTeamCollectionArticleSchema = createInsertSchema(teamCollectionArticlesTable).omit({ id: true });
export type InsertTeamCollectionArticle = z.infer<typeof insertTeamCollectionArticleSchema>;
export type TeamCollectionArticle = typeof teamCollectionArticlesTable.$inferSelect;
