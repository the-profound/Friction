-- Writing-stage records now live in thoughts. Keep the old articles table
-- intact for DIVIDING/CLOSING/LETTER records and retain a one-to-one marker
-- so this migration is safe to run more than once.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'thought_status') THEN
    CREATE TYPE "thought_status" AS ENUM ('NORMAL', 'PRELIMINARY');
  END IF;
END
$$;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'thought_promotion_type') THEN
    CREATE TYPE "thought_promotion_type" AS ENUM ('promote', 'cite');
  END IF;
END
$$;
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "thought_promotions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "from_thought_id" uuid NOT NULL,
  "to_draft_id" uuid NOT NULL,
  "promotion_type" "thought_promotion_type" NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'thought_promotions_from_thought_id_thoughts_id_fk'
  ) THEN
    ALTER TABLE "thought_promotions"
      ADD CONSTRAINT "thought_promotions_from_thought_id_thoughts_id_fk"
      FOREIGN KEY ("from_thought_id") REFERENCES "thoughts"("id");
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'thought_promotions_to_draft_id_articles_id_fk'
  ) THEN
    ALTER TABLE "thought_promotions"
      ADD CONSTRAINT "thought_promotions_to_draft_id_articles_id_fk"
      FOREIGN KEY ("to_draft_id") REFERENCES "articles"("id");
  END IF;
END
$$;
--> statement-breakpoint

ALTER TABLE "thoughts"
  ADD COLUMN IF NOT EXISTS "status" "thought_status" NOT NULL DEFAULT 'NORMAL',
  ADD COLUMN IF NOT EXISTS "migrated_from_article_id" uuid;
--> statement-breakpoint

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'thoughts_migrated_from_article_id_articles_id_fk'
  ) THEN
    ALTER TABLE "thoughts"
      ADD CONSTRAINT "thoughts_migrated_from_article_id_articles_id_fk"
      FOREIGN KEY ("migrated_from_article_id") REFERENCES "articles"("id");
  END IF;
END
$$;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "thoughts_migrated_from_article_unique_idx"
  ON "thoughts" ("migrated_from_article_id")
  WHERE "migrated_from_article_id" IS NOT NULL;
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "thought_promotions_from_thought_unique_idx"
  ON "thought_promotions" ("from_thought_id");
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "thoughts_writing_source_unique_idx"
  ON "thoughts" ("author_id", "source_article_id")
  WHERE "source_article_id" IS NOT NULL
    AND ("status" = 'PRELIMINARY' OR "migrated_from_article_id" IS NOT NULL);
--> statement-breakpoint

-- Preserve the source link for reading memos. Other legacy DRAFTs did not
-- carry enough provenance to distinguish their original entry point, so they
-- are intentionally imported as direct thoughts.
INSERT INTO "thoughts" (
  "author_id",
  "content",
  "source_article_id",
  "created_at",
  "updated_at",
  "deleted_at",
  "created_from",
  "status",
  "migrated_from_article_id"
)
SELECT
  a."author_id",
  '# ' || a."title" || E'\n\n' || a."content",
  a."source_article_id",
  a."created_at",
  a."updated_at",
  a."deleted_at",
  CASE
    WHEN a."source_article_id" IS NOT NULL THEN 'reading'::"thought_created_from"
    ELSE 'direct'::"thought_created_from"
  END,
  'NORMAL',
  a."id"
FROM "articles" a
WHERE a."status" = 'DRAFT'
  AND NOT EXISTS (
    SELECT 1
    FROM "thoughts" t
    WHERE t."migrated_from_article_id" = a."id"
  );