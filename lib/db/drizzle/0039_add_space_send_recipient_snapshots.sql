ALTER TABLE "space_scheduled_sends"
  ADD COLUMN IF NOT EXISTS "recipients_snapshotted_at" timestamptz;

CREATE TABLE IF NOT EXISTS "space_scheduled_send_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "scheduled_send_id" uuid NOT NULL
    REFERENCES "space_scheduled_sends"("id") ON DELETE CASCADE,
  "recipient_id" uuid NOT NULL REFERENCES "users"("id"),
  "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "space_scheduled_send_recipients_send_user_unique"
    UNIQUE ("scheduled_send_id", "recipient_id")
);

-- Preserve recipients already repaired by the preceding inbox migration.
INSERT INTO "space_scheduled_send_recipients" ("scheduled_send_id", "recipient_id")
SELECT DISTINCT i.source_space_scheduled_send_id, i.recipient_id
FROM "inbox" i
WHERE i.source_space_scheduled_send_id IS NOT NULL
ON CONFLICT ("scheduled_send_id", "recipient_id") DO NOTHING;

-- For historical SENT reservations that have never had inbox rows, take the
-- safest available snapshot: currently-approved users whose participation
-- existed by the send cutoff, plus the operator/creator. Later retries use
-- this immutable set and never fan out to newly joined users.
INSERT INTO "space_scheduled_send_recipients" ("scheduled_send_id", "recipient_id")
SELECT DISTINCT ss.id, expected.recipient_id
FROM "space_scheduled_sends" ss
JOIN "space_letters" sl
  ON sl.id = ss.space_letter_id
 AND sl.space_id = ss.space_id
CROSS JOIN LATERAL (
  SELECT sp.user_id AS recipient_id
  FROM "space_participations" sp
  WHERE sp.space_id = ss.space_id
    AND sp.status = 'APPROVED'
    AND sp.created_at <= COALESCE(ss.sent_at, ss.scheduled_at)
    -- No historical approved_at exists. updated_at before the cutoff is the
    -- conservative evidence that approval was already in effect.
    AND sp.updated_at <= COALESCE(ss.sent_at, ss.scheduled_at)
  UNION
  SELECT s.creator_id
  FROM "spaces" s
  WHERE s.id = ss.space_id
) expected
WHERE ss.status = 'SENT'
  AND expected.recipient_id <> sl.author_id
ON CONFLICT ("scheduled_send_id", "recipient_id") DO NOTHING;

UPDATE "space_scheduled_sends"
SET "recipients_snapshotted_at" = COALESCE(
  "recipients_snapshotted_at",
  "sent_at",
  "scheduled_at"
)
WHERE "status" = 'SENT';