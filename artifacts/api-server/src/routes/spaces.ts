import { Router, type IRouter } from "express";
import { eq, and, inArray, count } from "drizzle-orm";
import {
  db,
  spacesTable,
  spaceRoundsTable,
  spaceParticipationsTable,
  spaceInvitationsTable,
  spaceCodeRequestsTable,
  spaceLettersTable,
  spaceScheduledSendsTable,
  usersTable,
} from "@workspace/db";

const router: IRouter = Router();

router.get("/spaces", async (req, res) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const participations = await db
    .select({ spaceId: spaceParticipationsTable.spaceId })
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.userId, userId),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    );
  if (participations.length === 0) {
    res.json([]);
    return;
  }
  const spaceIds = participations.map((p) => p.spaceId);
  const spaces = await db
    .select()
    .from(spacesTable)
    .where(inArray(spacesTable.id, spaceIds));
  res.json(spaces);
});

router.post("/spaces", async (req, res) => {
  const body = req.body;
  const [space] = await db.insert(spacesTable).values(body).returning();
  if (body.creatorId) {
    await db.insert(spaceParticipationsTable).values({
      spaceId: space.id,
      userId: body.creatorId,
      role: "OPERATOR",
      status: "APPROVED",
    });
  }
  res.status(201).json(space);
});

router.get("/spaces/by-invite-code/:code", async (req, res) => {
  const { code } = req.params;
  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.inviteCode, code));
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  const [creator] = await db
    .select({ nickname: usersTable.nickname })
    .from(usersTable)
    .where(eq(usersTable.id, space.creatorId));
  const [{ value: participantCount }] = await db
    .select({ value: count() })
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, space.id),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    );
  res.json({ ...space, creatorNickname: creator?.nickname ?? null, participantCount });
});

router.get("/spaces/:id", async (req, res) => {
  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id));
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  res.json(space);
});

router.patch("/spaces/:id", async (req, res) => {
  const [space] = await db
    .update(spacesTable)
    .set(req.body)
    .where(eq(spacesTable.id, req.params.id))
    .returning();
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  res.json(space);
});

router.get("/spaces/:id/rounds", async (req, res) => {
  const rounds = await db
    .select()
    .from(spaceRoundsTable)
    .where(eq(spaceRoundsTable.spaceId, req.params.id));
  res.json(rounds);
});

router.post("/spaces/:id/rounds", async (req, res) => {
  const [round] = await db
    .insert(spaceRoundsTable)
    .values({ ...req.body, spaceId: req.params.id })
    .returning();
  res.status(201).json(round);
});

router.get("/spaces/:id/participations", async (req, res) => {
  const participations = await db
    .select()
    .from(spaceParticipationsTable)
    .where(eq(spaceParticipationsTable.spaceId, req.params.id));
  res.json(participations);
});

router.post("/spaces/:id/participations", async (req, res) => {
  const [participation] = await db
    .insert(spaceParticipationsTable)
    .values({ ...req.body, spaceId: req.params.id })
    .returning();
  res.status(201).json(participation);
});

router.patch("/spaces/:id/participations/:participationId", async (req, res) => {
  const [participation] = await db
    .update(spaceParticipationsTable)
    .set(req.body)
    .where(
      and(
        eq(spaceParticipationsTable.id, req.params.participationId),
        eq(spaceParticipationsTable.spaceId, req.params.id),
      ),
    )
    .returning();
  if (!participation) {
    res.status(404).json({ error: "Participation not found" });
    return;
  }
  res.json(participation);
});

router.get("/spaces/:id/invitations", async (req, res) => {
  const invitations = await db
    .select()
    .from(spaceInvitationsTable)
    .where(eq(spaceInvitationsTable.spaceId, req.params.id));
  res.json(invitations);
});

router.post("/spaces/:id/invitations", async (req, res) => {
  const [invitation] = await db
    .insert(spaceInvitationsTable)
    .values({ ...req.body, spaceId: req.params.id })
    .returning();
  res.status(201).json(invitation);
});

router.patch("/spaces/:id/invitations/:invitationId", async (req, res) => {
  const { status } = req.body;
  const [invitation] = await db
    .update(spaceInvitationsTable)
    .set({ status })
    .where(
      and(
        eq(spaceInvitationsTable.id, req.params.invitationId),
        eq(spaceInvitationsTable.spaceId, req.params.id),
      ),
    )
    .returning();
  if (!invitation) {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }
  if (status === "ACCEPTED") {
    await db.insert(spaceParticipationsTable).values({
      spaceId: req.params.id,
      userId: invitation.invitedUserId,
      role: "PARTICIPANT",
      status: "APPROVED",
      joinPath: "INVITATION",
      invitationId: invitation.id,
    }).onConflictDoNothing();
  }
  res.json(invitation);
});

router.post("/spaces/:id/code-requests", async (req, res) => {
  const [codeRequest] = await db
    .insert(spaceCodeRequestsTable)
    .values({ ...req.body, spaceId: req.params.id })
    .returning();
  res.status(201).json(codeRequest);
});

router.patch("/spaces/:id/code-requests/:requestId", async (req, res) => {
  const { status, rejectionReason } = req.body;
  const updateFields: Record<string, unknown> = { status };
  if (rejectionReason !== undefined) updateFields.rejectionReason = rejectionReason;

  const [codeRequest] = await db
    .update(spaceCodeRequestsTable)
    .set(updateFields)
    .where(
      and(
        eq(spaceCodeRequestsTable.id, req.params.requestId),
        eq(spaceCodeRequestsTable.spaceId, req.params.id),
      ),
    )
    .returning();
  if (!codeRequest) {
    res.status(404).json({ error: "Code request not found" });
    return;
  }
  if (status === "APPROVED") {
    await db.insert(spaceParticipationsTable).values({
      spaceId: req.params.id,
      userId: codeRequest.requesterId,
      role: "PARTICIPANT",
      status: "APPROVED",
      joinPath: "CODE",
      codeRequestId: codeRequest.id,
    }).onConflictDoNothing();
  }
  res.json(codeRequest);
});

router.get("/spaces/:id/join-context", async (req, res) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id));
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  const [creator] = await db
    .select({ nickname: usersTable.nickname })
    .from(usersTable)
    .where(eq(usersTable.id, space.creatorId));
  const [{ value: participantCount }] = await db
    .select({ value: count() })
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, space.id),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    );
  const spaceWithInfo = { ...space, creatorNickname: creator?.nickname ?? null, participantCount };

  const [participation] = await db
    .select()
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, req.params.id),
        eq(spaceParticipationsTable.userId, userId),
      ),
    );
  const [invitation] = await db
    .select()
    .from(spaceInvitationsTable)
    .where(
      and(
        eq(spaceInvitationsTable.spaceId, req.params.id),
        eq(spaceInvitationsTable.invitedUserId, userId),
      ),
    );
  const codeRequests = await db
    .select()
    .from(spaceCodeRequestsTable)
    .where(
      and(
        eq(spaceCodeRequestsTable.spaceId, req.params.id),
        eq(spaceCodeRequestsTable.requesterId, userId),
      ),
    )
    .orderBy(spaceCodeRequestsTable.createdAt);
  const codeRequest = codeRequests.at(-1) ?? null;

  res.json({
    space: spaceWithInfo,
    participation: participation ?? null,
    invitation: invitation ?? null,
    codeRequest,
  });
});

router.get("/spaces/:id/letters", async (req, res) => {
  const letters = await db
    .select()
    .from(spaceLettersTable)
    .where(eq(spaceLettersTable.spaceId, req.params.id));
  res.json(letters);
});

router.post("/spaces/:id/letters", async (req, res) => {
  const [letter] = await db
    .insert(spaceLettersTable)
    .values({ ...req.body, spaceId: req.params.id })
    .returning();
  res.status(201).json(letter);
});

router.get("/spaces/:id/letters/:letterId/scheduled-sends", async (req, res) => {
  const sends = await db
    .select()
    .from(spaceScheduledSendsTable)
    .where(
      and(
        eq(spaceScheduledSendsTable.spaceId, req.params.id),
        eq(spaceScheduledSendsTable.spaceLetterId, req.params.letterId),
      ),
    );
  res.json(sends);
});

router.post("/spaces/:id/letters/:letterId/scheduled-sends", async (req, res) => {
  const [send] = await db
    .insert(spaceScheduledSendsTable)
    .values({ ...req.body, spaceId: req.params.id, spaceLetterId: req.params.letterId })
    .returning();
  res.status(201).json(send);
});

router.get("/space-invitations", async (req, res) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const invitations = await db
    .select()
    .from(spaceInvitationsTable)
    .where(
      and(
        eq(spaceInvitationsTable.invitedUserId, userId),
        eq(spaceInvitationsTable.status, "PENDING"),
      ),
    );
  if (invitations.length === 0) {
    res.json([]);
    return;
  }
  const spaceIds = [...new Set(invitations.map((i) => i.spaceId))];
  const spaces = await db
    .select()
    .from(spacesTable)
    .where(inArray(spacesTable.id, spaceIds));

  const creatorIds = [...new Set(spaces.map((s) => s.creatorId))];
  const creators = await db
    .select({ id: usersTable.id, nickname: usersTable.nickname })
    .from(usersTable)
    .where(inArray(usersTable.id, creatorIds));
  const creatorMap = Object.fromEntries(creators.map((c) => [c.id, c.nickname]));

  const participantCounts = await db
    .select({ spaceId: spaceParticipationsTable.spaceId, value: count() })
    .from(spaceParticipationsTable)
    .where(
      and(
        inArray(spaceParticipationsTable.spaceId, spaceIds),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    )
    .groupBy(spaceParticipationsTable.spaceId);
  const countMap = Object.fromEntries(participantCounts.map((pc) => [pc.spaceId, pc.value]));

  const spaceMap = Object.fromEntries(
    spaces.map((s) => [
      s.id,
      { ...s, creatorNickname: creatorMap[s.creatorId] ?? null, participantCount: countMap[s.id] ?? 0 },
    ]),
  );

  const result = invitations
    .filter((inv) => spaceMap[inv.spaceId])
    .map((inv) => ({ ...inv, space: spaceMap[inv.spaceId] }));

  res.json(result);
});

export default router;
