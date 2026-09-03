-- The collection detail response resolves the earliest collection for each
-- article. Keep the article lookup and added_at ordering index-backed.
CREATE INDEX IF NOT EXISTS "my_collection_articles_article_added_idx"
  ON "my_collection_articles" ("article_id", "added_at");

CREATE INDEX IF NOT EXISTS "team_collection_articles_article_added_idx"
  ON "team_collection_articles" ("article_id", "added_at");