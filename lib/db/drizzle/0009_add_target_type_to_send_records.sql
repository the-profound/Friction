DO $$ BEGIN
  CREATE TYPE "send_record_target_type" AS ENUM('person', 'group');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "send_records"
  ADD COLUMN IF NOT EXISTS "target_type" "send_record_target_type" NOT NULL DEFAULT 'person',
  ADD COLUMN IF NOT EXISTS "team_collection_id" uuid REFERENCES "team_collections"("id"),
  ALTER COLUMN "recipient_id" DROP NOT NULL,
  ALTER COLUMN "inbox_id" DROP NOT NULL;
