ALTER TABLE "articles" ADD COLUMN "is_notice" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "articles" ADD COLUMN "notice_date" date;
