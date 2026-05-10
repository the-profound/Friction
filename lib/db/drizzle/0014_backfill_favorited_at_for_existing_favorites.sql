UPDATE "stored_sentences"
SET "favorited_at" = "created_at"
WHERE "is_favorite" = true AND "favorited_at" IS NULL;
