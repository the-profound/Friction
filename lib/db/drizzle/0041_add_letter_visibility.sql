-- Add space_letter_visibility enum and replace is_public with visibility on space_letters.
-- Add letter_recipient_access table for RECIPIENT_ONLY filtering.

CREATE TYPE "public"."space_letter_visibility" AS ENUM('PUBLIC', 'RECIPIENT_ONLY');--> statement-breakpoint

ALTER TABLE "space_letters"
  ADD COLUMN "visibility" "space_letter_visibility" NOT NULL DEFAULT 'PUBLIC';--> statement-breakpoint

-- Backfill: existing is_public=true rows keep PUBLIC; is_public=false rows stay PUBLIC
-- (task plan: default-migrate all to PUBLIC)

ALTER TABLE "space_letters"
  DROP COLUMN "is_public";--> statement-breakpoint

CREATE TABLE "letter_recipient_access" (
  "letter_id" uuid NOT NULL,
  "user_id" uuid NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "letter_recipient_access_letter_id_user_id_pk" PRIMARY KEY("letter_id","user_id")
);--> statement-breakpoint

ALTER TABLE "letter_recipient_access"
  ADD CONSTRAINT "letter_recipient_access_letter_id_space_letters_id_fk"
  FOREIGN KEY ("letter_id") REFERENCES "public"."space_letters"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

ALTER TABLE "letter_recipient_access"
  ADD CONSTRAINT "letter_recipient_access_user_id_users_id_fk"
  FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint

-- Backfill: populate from historical delivered scheduled-send recipients so that
-- letters changed to RECIPIENT_ONLY after delivery still show up for prior recipients.
INSERT INTO "letter_recipient_access" ("letter_id", "user_id", "created_at")
SELECT DISTINCT
  ss.space_letter_id AS letter_id,
  ssr.recipient_id   AS user_id,
  now()              AS created_at
FROM space_scheduled_send_recipients ssr
JOIN space_scheduled_sends ss ON ss.id = ssr.scheduled_send_id
WHERE ss.status = 'SENT'
ON CONFLICT DO NOTHING;
