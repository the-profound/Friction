import { pgTable, text, timestamp, unique, uuid, varchar } from "drizzle-orm/pg-core";

import { usersTable } from "./users";

export const pushTokensTable = pgTable(
  "push_tokens",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    userId: uuid("user_id")
      .notNull()
      .references(() => usersTable.id, { onDelete: "cascade" }),
    token: text("token").notNull(),
    platform: varchar("platform", { length: 10 }).notNull(), // 'ios' | 'android'
    deviceId: text("device_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [unique("push_tokens_user_token_unique").on(t.userId, t.token)],
);

export type PushToken = typeof pushTokensTable.$inferSelect;
