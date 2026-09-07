-- Durable "already notified" marker for the letter-arrived push job (Task
-- #2110). One row per (recipient_id, delivery_slot) pair; the unique
-- constraint lets the notification job atomically claim a recipient for a
-- given 06:00 KST delivery slot via INSERT ... ON CONFLICT DO NOTHING, so a
-- recipient can never be double-notified for the same slot no matter how
-- many times or in what order the notification job is triggered.
CREATE TABLE IF NOT EXISTS "letter_arrival_notifications" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "recipient_id" uuid NOT NULL
    REFERENCES "users"("id") ON DELETE CASCADE,
  "delivery_slot" timestamp with time zone NOT NULL,
  "letter_count" integer NOT NULL,
  "notified_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "letter_arrival_notifications_recipient_slot_unique"
    UNIQUE ("recipient_id", "delivery_slot")
);
