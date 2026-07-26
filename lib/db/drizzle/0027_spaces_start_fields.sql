-- Add space_schedule_type enum
DO $$ BEGIN
  CREATE TYPE "space_schedule_type" AS ENUM ('N_DAY', 'WEEKDAY');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Add new columns to spaces
ALTER TABLE "spaces"
  ADD COLUMN IF NOT EXISTS "planned_starts_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "started_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "schedule_type" "space_schedule_type",
  ADD COLUMN IF NOT EXISTS "weekdays" jsonb,
  ADD COLUMN IF NOT EXISTS "operator_participates" boolean NOT NULL DEFAULT true;

-- Copy existing starts_at values to planned_starts_at
UPDATE "spaces" SET "planned_starts_at" = "starts_at" WHERE "starts_at" IS NOT NULL;

-- Drop old starts_at column
ALTER TABLE "spaces" DROP COLUMN IF EXISTS "starts_at";
