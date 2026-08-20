import { boolean, check, date, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { articlesTable } from "./articles";
import { usersTable } from "./users";

export const spaceStatusEnum = pgEnum("space_status", ["RECRUITING", "ACTIVE", "ARCHIVED"]);
export const spaceRoundStatusEnum = pgEnum("space_round_status", ["UPCOMING", "ACTIVE", "COMPLETED"]);
export const spaceMemberRoleEnum = pgEnum("space_member_role", ["OPERATOR", "PARTICIPANT"]);
export const spaceJoinPathEnum = pgEnum("space_join_path", ["INVITATION", "CODE"]);
export const spaceParticipationStatusEnum = pgEnum("space_participation_status", ["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"]);
export const spaceInvitationStatusEnum = pgEnum("space_invitation_status", ["PENDING", "ACCEPTED", "DECLINED"]);
export const spaceCodeRequestStatusEnum = pgEnum("space_code_request_status", ["PENDING", "APPROVED", "REJECTED", "CANCELLED"]);
export const spaceLetterTypeEnum = pgEnum("space_letter_type", ["OPENING", "CENTER", "REPLY"]);
export const spaceScheduledSendStatusEnum = pgEnum("space_scheduled_send_status", ["PENDING", "SENT", "CANCELLED", "FAILED"]);
export const spaceScheduleTypeEnum = pgEnum("space_schedule_type", ["N_DAY", "WEEKDAY"]);

export const spacesTable = pgTable("spaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 50 }).notNull(),
  description: text("description"),
  isAnonymous: boolean("is_anonymous").notNull().default(false),
  plannedStartsAt: timestamp("planned_starts_at", { withTimezone: true }),
  startedAt: timestamp("started_at", { withTimezone: true }),
  scheduleType: spaceScheduleTypeEnum("schedule_type"),
  weekdays: jsonb("weekdays").$type<number[]>(),
  operatorParticipates: boolean("operator_participates").notNull().default(true),
  roundCount: integer("round_count").notNull().default(1),
  maxParticipants: integer("max_participants"),
  defaultCenterInterval: integer("default_center_interval").notNull().default(7),
  defaultCenterCount: integer("default_center_count").notNull().default(1),
  status: spaceStatusEnum("status").notNull().default("RECRUITING"),
  creatorId: uuid("creator_id").notNull().references(() => usersTable.id),
  inviteCode: varchar("invite_code", { length: 30 }).unique(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSpaceSchema = createInsertSchema(spacesTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSpace = z.infer<typeof insertSpaceSchema>;
export type Space = typeof spacesTable.$inferSelect;

export const spaceRoundsTable = pgTable("space_rounds", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spacesTable.id),
  roundNumber: integer("round_number").notNull(),
  title: varchar("title", { length: 100 }),
  description: text("description"),
  status: spaceRoundStatusEnum("status").notNull().default("UPCOMING"),
  startsAt: timestamp("starts_at", { withTimezone: true }),
  endsAt: timestamp("ends_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("space_rounds_space_round_unique").on(t.spaceId, t.roundNumber),
]);

export const insertSpaceRoundSchema = createInsertSchema(spaceRoundsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSpaceRound = z.infer<typeof insertSpaceRoundSchema>;
export type SpaceRound = typeof spaceRoundsTable.$inferSelect;

export const spaceInvitationsTable = pgTable("space_invitations", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spacesTable.id),
  invitedUserId: uuid("invited_user_id").notNull().references(() => usersTable.id),
  invitedBy: uuid("invited_by").notNull().references(() => usersTable.id),
  status: spaceInvitationStatusEnum("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("space_invitations_space_user_unique").on(t.spaceId, t.invitedUserId),
]);

export const insertSpaceInvitationSchema = createInsertSchema(spaceInvitationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSpaceInvitation = z.infer<typeof insertSpaceInvitationSchema>;
export type SpaceInvitation = typeof spaceInvitationsTable.$inferSelect;

export const spaceCodeRequestsTable = pgTable("space_code_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spacesTable.id),
  requesterId: uuid("requester_id").notNull().references(() => usersTable.id),
  code: varchar("code", { length: 20 }).notNull(),
  spaceNickname: varchar("space_nickname", { length: 20 }),
  status: spaceCodeRequestStatusEnum("status").notNull().default("PENDING"),
  rejectionReason: text("rejection_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  uniqueIndex("space_code_requests_active_nickname_unique")
    .on(t.spaceId, sql`lower(btrim(${t.spaceNickname}))`)
    .where(sql`${t.spaceNickname} IS NOT NULL AND ${t.status} IN ('PENDING', 'APPROVED')`),
]);

export const insertSpaceCodeRequestSchema = createInsertSchema(spaceCodeRequestsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSpaceCodeRequest = z.infer<typeof insertSpaceCodeRequestSchema>;
export type SpaceCodeRequest = typeof spaceCodeRequestsTable.$inferSelect;

export const spaceParticipationsTable = pgTable("space_participations", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spacesTable.id),
  userId: uuid("user_id").notNull().references(() => usersTable.id),
  role: spaceMemberRoleEnum("role").notNull().default("PARTICIPANT"),
  joinPath: spaceJoinPathEnum("join_path"),
  status: spaceParticipationStatusEnum("status").notNull().default("PENDING"),
  spaceNickname: varchar("space_nickname", { length: 20 }),
  invitationId: uuid("invitation_id").references(() => spaceInvitationsTable.id),
  codeRequestId: uuid("code_request_id").references(() => spaceCodeRequestsTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  unique("space_participations_space_user_unique").on(t.spaceId, t.userId),
  uniqueIndex("space_participations_active_nickname_unique")
    .on(t.spaceId, sql`lower(btrim(${t.spaceNickname}))`)
    .where(sql`${t.spaceNickname} IS NOT NULL AND ${t.status} IN ('PENDING', 'APPROVED')`),
  check(
    "space_participations_join_path_fk_check",
    sql`(${t.joinPath} = 'INVITATION' AND ${t.invitationId} IS NOT NULL AND ${t.codeRequestId} IS NULL)
     OR (${t.joinPath} = 'CODE' AND ${t.codeRequestId} IS NOT NULL AND ${t.invitationId} IS NULL)
     OR (${t.joinPath} IS NULL AND ${t.invitationId} IS NULL AND ${t.codeRequestId} IS NULL)`,
  ),
  check(
    "space_participations_invitation_status_check",
    sql`${t.joinPath} != 'INVITATION' OR ${t.status} IN ('APPROVED', 'WITHDRAWN')`,
  ),
]);

export const insertSpaceParticipationSchema = createInsertSchema(spaceParticipationsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSpaceParticipation = z.infer<typeof insertSpaceParticipationSchema>;
export type SpaceParticipation = typeof spaceParticipationsTable.$inferSelect;

export const spaceLettersTable = pgTable("space_letters", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spacesTable.id),
  spaceRoundId: uuid("space_round_id").references(() => spaceRoundsTable.id),
  authorId: uuid("author_id").notNull().references(() => usersTable.id),
  sourceArticleId: uuid("source_article_id").references(() => articlesTable.id),
  letterType: spaceLetterTypeEnum("letter_type").notNull(),
  isPublic: boolean("is_public").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
}, (t) => [
  // At most one OPENING letter per round. Rows with a NULL spaceRoundId
  // (pre-start drafts created before any round exists) are exempt — Postgres
  // treats NULLs as distinct for uniqueness purposes, so this only guards
  // rounds that have actually been assigned.
  uniqueIndex("space_letters_opening_per_round_unique")
    .on(t.spaceRoundId)
    .where(sql`${t.letterType} = 'OPENING'`),
]);

export const insertSpaceLetterSchema = createInsertSchema(spaceLettersTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSpaceLetter = z.infer<typeof insertSpaceLetterSchema>;
export type SpaceLetter = typeof spaceLettersTable.$inferSelect;

export const spaceScheduledSendsTable = pgTable("space_scheduled_sends", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceId: uuid("space_id").notNull().references(() => spacesTable.id),
  spaceLetterId: uuid("space_letter_id").notNull().references(() => spaceLettersTable.id),
  slotId: uuid("slot_id").references(() => spaceRoundSlotsTable.id, { onDelete: "set null" }),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }).notNull(),
  status: spaceScheduledSendStatusEnum("status").notNull().default("PENDING"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  failureReason: text("failure_reason"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSpaceScheduledSendSchema = createInsertSchema(spaceScheduledSendsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSpaceScheduledSend = z.infer<typeof insertSpaceScheduledSendSchema>;
export type SpaceScheduledSend = typeof spaceScheduledSendsTable.$inferSelect;

export const spaceRoundSlotsTable = pgTable("space_round_slots", {
  id: uuid("id").defaultRandom().primaryKey(),
  spaceRoundId: uuid("space_round_id").notNull().references(() => spaceRoundsTable.id, { onDelete: "cascade" }),
  assignedUserId: uuid("assigned_user_id").notNull().references(() => usersTable.id),
  slotOrder: integer("slot_order").notNull().default(0),
  scheduledDate: date("scheduled_date"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow().$onUpdate(() => new Date()),
});

export const insertSpaceRoundSlotSchema = createInsertSchema(spaceRoundSlotsTable).omit({ id: true, createdAt: true, updatedAt: true });
export type InsertSpaceRoundSlot = z.infer<typeof insertSpaceRoundSlotSchema>;
export type SpaceRoundSlot = typeof spaceRoundSlotsTable.$inferSelect;
