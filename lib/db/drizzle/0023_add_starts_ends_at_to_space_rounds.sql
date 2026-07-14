ALTER TABLE "space_rounds" ADD COLUMN IF NOT EXISTS "starts_at" timestamp with time zone;
ALTER TABLE "space_rounds" ADD COLUMN IF NOT EXISTS "ends_at" timestamp with time zone;
