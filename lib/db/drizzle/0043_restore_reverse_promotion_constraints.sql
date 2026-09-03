-- Reverse-promotion requires two partial uniqueness rules:
--   1. deleted thoughts no longer reserve a writing source;
--   2. one review article has at most one `promote` origin.
-- `cite` links intentionally remain unrestricted by the target-side rule.

-- Never guess which user content or provenance should survive. Environments
-- with ambiguous legacy data fail before DDL with actionable counts, leaving
-- every row untouched so operators can inspect and resolve the conflict.
DO $$
DECLARE
  orphan_promotions integer;
  active_source_conflicts integer;
  promote_target_conflicts integer;
BEGIN
  SELECT count(*) INTO orphan_promotions
  FROM "thought_promotions" AS promotion
  LEFT JOIN "thoughts" AS thought
    ON thought."id" = promotion."from_thought_id"
  LEFT JOIN "articles" AS article
    ON article."id" = promotion."to_draft_id"
  WHERE thought."id" IS NULL OR article."id" IS NULL;

  SELECT count(*) INTO active_source_conflicts
  FROM (
    SELECT "author_id", "source_article_id"
    FROM "thoughts"
    WHERE "source_article_id" IS NOT NULL
      AND "deleted_at" IS NULL
      AND ("status" = 'PRELIMINARY' OR "migrated_from_article_id" IS NOT NULL)
    GROUP BY "author_id", "source_article_id"
    HAVING count(*) > 1
  ) conflicts;

  SELECT count(*) INTO promote_target_conflicts
  FROM (
    SELECT "to_draft_id"
    FROM "thought_promotions"
    WHERE "promotion_type" = 'promote'
    GROUP BY "to_draft_id"
    HAVING count(*) > 1
  ) conflicts;

  IF orphan_promotions > 0
    OR active_source_conflicts > 0
    OR promote_target_conflicts > 0
  THEN
    RAISE EXCEPTION
      'reverse-promotion preflight failed: orphan promotions=%, active source conflicts=%, promote target conflicts=%; no rows were changed',
      orphan_promotions,
      active_source_conflicts,
      promote_target_conflicts;
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
    AND ("status" = 'PRELIMINARY' OR "migrated_from_article_id" IS NOT NULL);
--> statement-breakpoint

CREATE UNIQUE INDEX IF NOT EXISTS "thought_promotions_to_draft_promote_unique_idx"
  ON "thought_promotions" ("to_draft_id")
  WHERE "promotion_type" = 'promote';