CREATE TABLE IF NOT EXISTS "space_round_slots" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_round_id" uuid NOT NULL REFERENCES "space_rounds"("id") ON DELETE CASCADE,
  "assigned_user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "slot_order" integer NOT NULL DEFAULT 0,
  "scheduled_date" date,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
