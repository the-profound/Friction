ALTER TABLE "reading_records"
ADD COLUMN IF NOT EXISTS "save_revision" bigint NOT NULL DEFAULT 0;