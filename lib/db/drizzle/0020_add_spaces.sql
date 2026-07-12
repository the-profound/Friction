CREATE TYPE "public"."space_status" AS ENUM('RECRUITING', 'ACTIVE', 'ARCHIVED');--> statement-breakpoint
CREATE TYPE "public"."space_round_status" AS ENUM('UPCOMING', 'ACTIVE', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."space_member_role" AS ENUM('OPERATOR', 'PARTICIPANT');--> statement-breakpoint
CREATE TYPE "public"."space_join_path" AS ENUM('INVITATION', 'CODE');--> statement-breakpoint
CREATE TYPE "public"."space_participation_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN');--> statement-breakpoint
CREATE TYPE "public"."space_invitation_status" AS ENUM('PENDING', 'ACCEPTED', 'DECLINED');--> statement-breakpoint
CREATE TYPE "public"."space_code_request_status" AS ENUM('PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."space_letter_type" AS ENUM('OPENING', 'CENTER', 'REPLY');--> statement-breakpoint
CREATE TYPE "public"."space_scheduled_send_status" AS ENUM('PENDING', 'SENT', 'CANCELLED');--> statement-breakpoint

CREATE TABLE "spaces" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "name" varchar(50) NOT NULL,
  "description" text,
  "is_anonymous" boolean NOT NULL DEFAULT false,
  "starts_at" timestamptz,
  "round_count" integer NOT NULL DEFAULT 1,
  "max_participants" integer,
  "default_center_interval" integer NOT NULL DEFAULT 7,
  "default_center_count" integer NOT NULL DEFAULT 1,
  "status" "space_status" NOT NULL DEFAULT 'RECRUITING',
  "creator_id" uuid NOT NULL REFERENCES "users"("id"),
  "invite_code" varchar(20) UNIQUE,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE "space_rounds" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id"),
  "round_number" integer NOT NULL,
  "title" varchar(100),
  "description" text,
  "status" "space_round_status" NOT NULL DEFAULT 'UPCOMING',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "space_rounds_space_round_unique" UNIQUE ("space_id", "round_number")
);--> statement-breakpoint

CREATE TABLE "space_invitations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id"),
  "invited_user_id" uuid NOT NULL REFERENCES "users"("id"),
  "invited_by" uuid NOT NULL REFERENCES "users"("id"),
  "status" "space_invitation_status" NOT NULL DEFAULT 'PENDING',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "space_invitations_space_user_unique" UNIQUE ("space_id", "invited_user_id")
);--> statement-breakpoint

CREATE TABLE "space_code_requests" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id"),
  "requester_id" uuid NOT NULL REFERENCES "users"("id"),
  "code" varchar(20) NOT NULL,
  "status" "space_code_request_status" NOT NULL DEFAULT 'PENDING',
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE "space_participations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id"),
  "user_id" uuid NOT NULL REFERENCES "users"("id"),
  "role" "space_member_role" NOT NULL DEFAULT 'PARTICIPANT',
  "join_path" "space_join_path",
  "status" "space_participation_status" NOT NULL DEFAULT 'PENDING',
  "invitation_id" uuid REFERENCES "space_invitations"("id"),
  "code_request_id" uuid REFERENCES "space_code_requests"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "space_participations_space_user_unique" UNIQUE ("space_id", "user_id")
);--> statement-breakpoint

CREATE TABLE "space_letters" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id"),
  "space_round_id" uuid REFERENCES "space_rounds"("id"),
  "author_id" uuid NOT NULL REFERENCES "users"("id"),
  "source_article_id" uuid REFERENCES "articles"("id"),
  "letter_type" "space_letter_type" NOT NULL,
  "is_public" boolean NOT NULL DEFAULT false,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE TABLE "space_scheduled_sends" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "space_id" uuid NOT NULL REFERENCES "spaces"("id"),
  "space_letter_id" uuid NOT NULL REFERENCES "space_letters"("id"),
  "scheduled_at" timestamptz NOT NULL,
  "status" "space_scheduled_send_status" NOT NULL DEFAULT 'PENDING',
  "sent_at" timestamptz,
  "created_at" timestamptz NOT NULL DEFAULT now(),
  "updated_at" timestamptz NOT NULL DEFAULT now()
);--> statement-breakpoint

CREATE INDEX "spaces_creator_idx" ON "spaces" ("creator_id");--> statement-breakpoint
CREATE INDEX "space_rounds_space_idx" ON "space_rounds" ("space_id");--> statement-breakpoint
CREATE INDEX "space_participations_space_idx" ON "space_participations" ("space_id");--> statement-breakpoint
CREATE INDEX "space_participations_user_idx" ON "space_participations" ("user_id");--> statement-breakpoint
CREATE INDEX "space_invitations_space_idx" ON "space_invitations" ("space_id");--> statement-breakpoint
CREATE INDEX "space_code_requests_space_idx" ON "space_code_requests" ("space_id");--> statement-breakpoint
CREATE INDEX "space_letters_space_idx" ON "space_letters" ("space_id");--> statement-breakpoint
CREATE INDEX "space_letters_round_idx" ON "space_letters" ("space_round_id");--> statement-breakpoint
CREATE INDEX "space_scheduled_sends_space_idx" ON "space_scheduled_sends" ("space_id");--> statement-breakpoint
CREATE INDEX "space_scheduled_sends_letter_idx" ON "space_scheduled_sends" ("space_letter_id");
