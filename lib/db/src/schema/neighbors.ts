import { pgEnum, pgTable, timestamp, unique, uuid } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

import { usersTable } from "./users";

export const neighborsTable = pgTable("neighbors", {
  id: uuid("id").defaultRandom().primaryKey(),
  userAId: uuid("user_a_id").notNull().references(() => usersTable.id),
  userBId: uuid("user_b_id").notNull().references(() => usersTable.id),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  acceptedAt: timestamp("accepted_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("neighbors_pair_unique").on(t.userAId, t.userBId),
]);

export const insertNeighborSchema = createInsertSchema(neighborsTable).omit({ id: true, createdAt: true, acceptedAt: true });
export type InsertNeighbor = z.infer<typeof insertNeighborSchema>;
export type Neighbor = typeof neighborsTable.$inferSelect;

export const neighborRequestStatusEnum = pgEnum("neighbor_request_status", ["PENDING"]);

export const neighborRequestsTable = pgTable("neighbor_requests", {
  id: uuid("id").defaultRandom().primaryKey(),
  requesterId: uuid("requester_id").notNull().references(() => usersTable.id),
  recipientId: uuid("recipient_id").notNull().references(() => usersTable.id),
  status: neighborRequestStatusEnum("status").notNull().default("PENDING"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  unique("neighbor_requests_unique").on(t.requesterId, t.recipientId),
]);

export const insertNeighborRequestSchema = createInsertSchema(neighborRequestsTable).omit({ id: true, createdAt: true });
export type InsertNeighborRequest = z.infer<typeof insertNeighborRequestSchema>;
export type NeighborRequest = typeof neighborRequestsTable.$inferSelect;
