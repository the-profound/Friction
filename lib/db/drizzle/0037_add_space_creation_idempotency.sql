ALTER TABLE "spaces" ADD COLUMN IF NOT EXISTS "creation_key" varchar(64);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "spaces_creator_creation_key_unique"
  ON "spaces" USING btree ("creator_id", "creation_key")
  WHERE "spaces"."creation_key" IS NOT NULL;