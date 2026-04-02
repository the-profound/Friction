ALTER TABLE "users" ADD COLUMN "recent_saved_collection_id" uuid;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "source_article_id" uuid;