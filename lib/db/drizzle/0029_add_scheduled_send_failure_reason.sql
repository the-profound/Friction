-- Migration: add failure_reason to space_scheduled_sends so operators/authors
-- can see why a reservation failed to process.
ALTER TABLE "space_scheduled_sends" ADD COLUMN IF NOT EXISTS "failure_reason" text;
