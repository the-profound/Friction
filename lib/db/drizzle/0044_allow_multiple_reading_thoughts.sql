-- Reading and question flows intentionally allow more than one active
-- PRELIMINARY thought for the same source article. Only a thought restored by
-- reverse-promotion reserves the writing source.
ALTER TABLE "thoughts"
  ADD COLUMN IF NOT EXISTS "create_request_generation" integer NOT NULL DEFAULT 1;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'thoughts_create_request_generation_positive_check'
  ) THEN
    ALTER TABLE "thoughts"
      ADD CONSTRAINT "thoughts_create_request_generation_positive_check"
      CHECK ("create_request_generation" > 0);
  END IF;
END
$$;
--> statement-breakpoint

DO $$
DECLARE
  restored_source_conflicts integer;
BEGIN
  SELECT count(*) INTO restored_source_conflicts
  FROM (
    SELECT "author_id", "source_article_id"
    FROM "thoughts"
    WHERE "source_article_id" IS NOT NULL
      AND "deleted_at" IS NULL
      AND "migrated_from_article_id" IS NOT NULL
    GROUP BY "author_id", "source_article_id"
    HAVING count(*) > 1
  ) conflicts;

  IF restored_source_conflicts > 0 THEN
    RAISE EXCEPTION
      'reading-thought uniqueness preflight failed: restored source conflicts=%; no rows were changed',
      restored_source_conflicts;
  END IF;
END
$$;
--> statement-breakpoint

DROP INDEX IF EXISTS "thoughts_writing_source_unique_idx";
--> statement-breakpoint

CREATE UNIQUE INDEX "thoughts_writing_source_unique_idx"
  ON "thoughts" ("author_id", "source_article_id")
  WHERE "source_article_id" IS NOT NULL
    AND "deleted_at" IS NULL
    AND "migrated_from_article_id" IS NOT NULL;