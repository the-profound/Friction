-- Enforce join-path / FK source consistency on space_participations:
--   INVITATION join path → invitation_id required, code_request_id must be null
--   CODE join path → code_request_id required, invitation_id must be null
--   NULL join path (creator / direct add) → both FKs must be null
ALTER TABLE "space_participations"
  ADD CONSTRAINT "space_participations_join_path_fk_check"
  CHECK (
    (join_path = 'INVITATION' AND invitation_id IS NOT NULL AND code_request_id IS NULL)
    OR (join_path = 'CODE' AND code_request_id IS NOT NULL AND invitation_id IS NULL)
    OR (join_path IS NULL AND invitation_id IS NULL AND code_request_id IS NULL)
  );--> statement-breakpoint

-- Encode "초대 즉시 승인" business rule at DB level:
-- Invitation-based participations skip PENDING — only APPROVED or WITHDRAWN are valid.
ALTER TABLE "space_participations"
  ADD CONSTRAINT "space_participations_invitation_status_check"
  CHECK (
    join_path != 'INVITATION' OR status IN ('APPROVED', 'WITHDRAWN')
  );--> statement-breakpoint

-- Code requests must stay PENDING while open; APPROVED/REJECTED are terminal.
-- Guard: a code request can only be APPROVED or REJECTED (not re-opened to PENDING)
-- once it has been actioned. This is enforced via the participation approval flow,
-- but we also prevent impossible status values at the enum level (already done).
-- Add a reminder CHECK that code request status is always one of the defined values
-- (already guaranteed by the enum, so this is a belt-and-suspenders explicit constraint).
ALTER TABLE "space_code_requests"
  ADD CONSTRAINT "space_code_requests_status_valid"
  CHECK (status IN ('PENDING', 'APPROVED', 'REJECTED'));
