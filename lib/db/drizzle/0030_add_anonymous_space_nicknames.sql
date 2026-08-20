-- Store a nickname chosen for one anonymous space separately from the
-- account-wide nickname. Existing rows intentionally remain NULL: they must
-- be rendered as the safe "참여자" fallback rather than being backfilled from
-- users.nickname.
ALTER TABLE "space_participations"
  ADD COLUMN IF NOT EXISTS "space_nickname" varchar(20);
--> statement-breakpoint

ALTER TABLE "space_code_requests"
  ADD COLUMN IF NOT EXISTS "space_nickname" varchar(20);
--> statement-breakpoint

-- A nickname is reserved while a participation is pending or approved.
-- REJECTED/WITHDRAWN rows release it for a later join.
CREATE UNIQUE INDEX IF NOT EXISTS "space_participations_active_nickname_unique"
  ON "space_participations" ("space_id", lower(btrim("space_nickname")))
  WHERE "space_nickname" IS NOT NULL
    AND "status" IN ('PENDING', 'APPROVED');
--> statement-breakpoint

-- Pending and approved code requests reserve a nickname too. The API locks
-- the owning space row when moving a request into a participation so this
-- index and the participation index remain race-safe across both tables.
CREATE UNIQUE INDEX IF NOT EXISTS "space_code_requests_active_nickname_unique"
  ON "space_code_requests" ("space_id", lower(btrim("space_nickname")))
  WHERE "space_nickname" IS NOT NULL
    AND "status" IN ('PENDING', 'APPROVED');