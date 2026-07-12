import { Router, type IRouter } from "express";
import { eq, and, inArray } from "drizzle-orm";
import {
  db,
  spacesTable,
  spaceRoundsTable,
  spaceParticipationsTable,
  spaceInvitationsTable,
  spaceCodeRequestsTable,
  spaceLettersTable,
  spaceScheduledSendsTable,
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
  const [invitation] = await db
    .update(spaceInvitationsTable)
    .set(req.body)
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
  const [codeRequest] = await db
    .update(spaceCodeRequestsTable)
    .set(req.body)
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
  res.json(codeRequest);
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

export default router;
