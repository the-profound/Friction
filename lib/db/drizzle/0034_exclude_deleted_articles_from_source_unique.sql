-- A deleted legacy DRAFT must not reserve its source article forever.  The
-- active promoted article inherits that source link, so source uniqueness is
-- intentionally limited to active articles.
DROP INDEX IF EXISTS "articles_author_source_unique_idx";
--> statement-breakpoint

CREATE UNIQUE INDEX "articles_author_source_unique_idx"
  ON "articles" ("author_id", "source_article_id")
  WHERE "source_article_id" IS NOT NULL
    AND "deleted_at" IS NULL;