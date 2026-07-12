-- Enable Row-Level Security on all spaces tables
ALTER TABLE "spaces" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "space_rounds" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "space_participations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "space_invitations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "space_code_requests" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "space_letters" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "space_scheduled_sends" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint

-- spaces: Visible to approved participants or creator
CREATE POLICY "spaces_select" ON "spaces" FOR SELECT USING (
  creator_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = spaces.id
      AND sp.user_id = auth.uid()
      AND sp.status = 'APPROVED'
  )
);--> statement-breakpoint

CREATE POLICY "spaces_insert" ON "spaces" FOR INSERT WITH CHECK (creator_id = auth.uid());--> statement-breakpoint

CREATE POLICY "spaces_update" ON "spaces" FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = spaces.id
      AND sp.user_id = auth.uid()
      AND sp.role = 'OPERATOR'
      AND sp.status = 'APPROVED'
  )
);--> statement-breakpoint

-- space_rounds: Visible to and managed by approved participants / operators
CREATE POLICY "space_rounds_select" ON "space_rounds" FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = space_rounds.space_id
      AND sp.user_id = auth.uid()
      AND sp.status = 'APPROVED'
  )
);--> statement-breakpoint

CREATE POLICY "space_rounds_insert" ON "space_rounds" FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = space_rounds.space_id
      AND sp.user_id = auth.uid()
      AND sp.role = 'OPERATOR'
      AND sp.status = 'APPROVED'
  )
);--> statement-breakpoint

CREATE POLICY "space_rounds_update" ON "space_rounds" FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = space_rounds.space_id
      AND sp.user_id = auth.uid()
      AND sp.role = 'OPERATOR'
      AND sp.status = 'APPROVED'
  )
);--> statement-breakpoint

-- space_participations: Visible to self or operators; insertable by self
CREATE POLICY "space_participations_select" ON "space_participations" FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM space_participations sp2
    WHERE sp2.space_id = space_participations.space_id
      AND sp2.user_id = auth.uid()
      AND sp2.role = 'OPERATOR'
      AND sp2.status = 'APPROVED'
  )
);--> statement-breakpoint

CREATE POLICY "space_participations_insert" ON "space_participations" FOR INSERT WITH CHECK (user_id = auth.uid());--> statement-breakpoint

CREATE POLICY "space_participations_update" ON "space_participations" FOR UPDATE USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM space_participations sp2
    WHERE sp2.space_id = space_participations.space_id
      AND sp2.user_id = auth.uid()
      AND sp2.role = 'OPERATOR'
      AND sp2.status = 'APPROVED'
  )
);--> statement-breakpoint

-- space_invitations: Visible to invitee, inviter, or operators
CREATE POLICY "space_invitations_select" ON "space_invitations" FOR SELECT USING (
  invited_user_id = auth.uid()
  OR invited_by = auth.uid()
  OR EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = space_invitations.space_id
      AND sp.user_id = auth.uid()
      AND sp.role = 'OPERATOR'
      AND sp.status = 'APPROVED'
  )
);--> statement-breakpoint

CREATE POLICY "space_invitations_insert" ON "space_invitations" FOR INSERT WITH CHECK (
  invited_by = auth.uid()
  AND EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = space_invitations.space_id
      AND sp.user_id = auth.uid()
      AND sp.role = 'OPERATOR'
      AND sp.status = 'APPROVED'
  )
);--> statement-breakpoint

CREATE POLICY "space_invitations_update" ON "space_invitations" FOR UPDATE USING (
  invited_user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = space_invitations.space_id
      AND sp.user_id = auth.uid()
      AND sp.role = 'OPERATOR'
      AND sp.status = 'APPROVED'
  )
);--> statement-breakpoint

-- space_code_requests: Visible to requester or operators
CREATE POLICY "space_code_requests_select" ON "space_code_requests" FOR SELECT USING (
  requester_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = space_code_requests.space_id
      AND sp.user_id = auth.uid()
      AND sp.role = 'OPERATOR'
      AND sp.status = 'APPROVED'
  )
);--> statement-breakpoint

CREATE POLICY "space_code_requests_insert" ON "space_code_requests" FOR INSERT WITH CHECK (requester_id = auth.uid());--> statement-breakpoint

CREATE POLICY "space_code_requests_update" ON "space_code_requests" FOR UPDATE USING (
  EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = space_code_requests.space_id
      AND sp.user_id = auth.uid()
      AND sp.role = 'OPERATOR'
      AND sp.status = 'APPROVED'
  )
);--> statement-breakpoint

-- space_letters: Visible to approved participants; insertable by approved participants
CREATE POLICY "space_letters_select" ON "space_letters" FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = space_letters.space_id
      AND sp.user_id = auth.uid()
      AND sp.status = 'APPROVED'
  )
);--> statement-breakpoint

CREATE POLICY "space_letters_insert" ON "space_letters" FOR INSERT WITH CHECK (
  author_id = auth.uid()
  AND EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = space_letters.space_id
      AND sp.user_id = auth.uid()
      AND sp.status = 'APPROVED'
  )
);--> statement-breakpoint

-- space_scheduled_sends: Visible to and managed by operators
CREATE POLICY "space_scheduled_sends_select" ON "space_scheduled_sends" FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = space_scheduled_sends.space_id
      AND sp.user_id = auth.uid()
      AND sp.role = 'OPERATOR'
      AND sp.status = 'APPROVED'
  )
);--> statement-breakpoint

CREATE POLICY "space_scheduled_sends_insert" ON "space_scheduled_sends" FOR INSERT WITH CHECK (
  EXISTS (
    SELECT 1 FROM space_participations sp
    WHERE sp.space_id = space_scheduled_sends.space_id
      AND sp.user_id = auth.uid()
      AND sp.role = 'OPERATOR'
      AND sp.status = 'APPROVED'
  )
);
