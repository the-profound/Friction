-- Migration: add push_tokens table for Expo push notification tokens
CREATE TABLE IF NOT EXISTS "push_tokens" (
  "id" uuid DEFAULT gen_random_uuid() PRIMARY KEY NOT NULL,
  "user_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE CASCADE,
  "token" text NOT NULL,
  "platform" varchar(10) NOT NULL,
  "device_id" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "push_tokens_user_token_unique" UNIQUE("user_id","token")
);
