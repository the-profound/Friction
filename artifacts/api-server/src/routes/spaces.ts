import { Router, type IRouter } from "express";
import { eq, and, inArray, count } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
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
  articlesTable,
} from "@workspace/db";

const router: IRouter = Router();

// ─── My invitations (must be before /:id) ───────────────────────────────────
router.get("/spaces/my-invitations", async (req, res) => {
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
  const spaceMap = new Map(spaces.map((s) => [s.id, s]));
  const result = invitations
    .filter((i) => spaceMap.has(i.spaceId))
    .map((i) => ({ invitation: i, space: spaceMap.get(i.spaceId)! }));
  res.json(result);
});

// ─── My code requests (must be before /:id) ─────────────────────────────────
router.get("/spaces/my-code-requests", async (req, res) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const codeRequests = await db
    .select()
    .from(spaceCodeRequestsTable)
    .where(
      and(
        eq(spaceCodeRequestsTable.requesterId, userId),
        eq(spaceCodeRequestsTable.status, "PENDING"),
      ),
    );
  if (codeRequests.length === 0) {
    res.json([]);
    return;
  }
  const spaceIds = [...new Set(codeRequests.map((r) => r.spaceId))];
  const spaces = await db
    .select()
    .from(spacesTable)
    .where(inArray(spacesTable.id, spaceIds));
  const spaceMap = new Map(spaces.map((s) => [s.id, s]));
  const result = codeRequests
    .filter((r) => spaceMap.has(r.spaceId))
    .map((r) => ({ codeRequest: r, space: spaceMap.get(r.spaceId)! }));
  res.json(result);
});

// ─── List spaces (enriched with role + participant count) ────────────────────
router.get("/spaces", async (req, res) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }
  const participations = await db
    .select()
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
  const roleMap = new Map(
    participations.map((p) => [p.spaceId, p.role]),
  );

  const [spaces, allParticipations, allRounds] = await Promise.all([
    db.select().from(spacesTable).where(inArray(spacesTable.id, spaceIds)),
    db
      .select()
      .from(spaceParticipationsTable)
      .where(
        and(
          inArray(spaceParticipationsTable.spaceId, spaceIds),
          eq(spaceParticipationsTable.status, "APPROVED"),
        ),
      ),
    db
      .select()
      .from(spaceRoundsTable)
      .where(
        and(
          inArray(spaceRoundsTable.spaceId, spaceIds),
          eq(spaceRoundsTable.status, "ACTIVE"),
        ),
      ),
  ]);

  const participantCountMap = new Map<string, number>();
  for (const p of allParticipations) {
    participantCountMap.set(p.spaceId, (participantCountMap.get(p.spaceId) ?? 0) + 1);
  }

  const activeRoundMap = new Map(allRounds.map((r) => [r.spaceId, r]));

  const creatorIds = [...new Set(spaces.map((s) => s.creatorId))];
  const creators = creatorIds.length > 0
    ? await db
        .select({ id: usersTable.id, nickname: usersTable.nickname })
        .from(usersTable)
        .where(inArray(usersTable.id, creatorIds))
    : [];
  const creatorNicknameMap = new Map(creators.map((u) => [u.id, u.nickname]));

  const result = spaces.map((space) => ({
    ...space,
    myRole: roleMap.get(space.id) ?? "PARTICIPANT",
    participantCount: participantCountMap.get(space.id) ?? 0,
    activeRound: activeRoundMap.get(space.id) ?? null,
    operatorNickname: creatorNicknameMap.get(space.creatorId) ?? null,
  }));

  res.json(result);
});

router.post("/spaces", async (req, res) => {
  const body = req.body;
  if (!body.creatorId) {
    res.status(400).json({ error: "creatorId is required" });
    return;
  }
  try {
    const [space] = await db.insert(spacesTable).values(body).returning();
    await db.insert(spaceParticipationsTable).values({
      spaceId: space.id,
      userId: body.creatorId,
      role: "OPERATOR",
      status: "APPROVED",
    });
    res.status(201).json(space);
  } catch (err) {
    console.error("POST /spaces error:", err);
    res.status(500).json({ error: "공간 생성에 실패했습니다." });
  }
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

router.patch("/spaces/:id", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const [callerParticipation] = await db
    .select()
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, req.params.id),
        eq(spaceParticipationsTable.userId, callerId),
        eq(spaceParticipationsTable.role, "OPERATOR"),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    )
    .limit(1);
  if (!callerParticipation) {
    res.status(403).json({ error: "Only operators can update a space" });
    return;
  }
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
  try {
    const [round] = await db
      .insert(spaceRoundsTable)
      .values({ ...req.body, spaceId: req.params.id })
      .returning();
    res.status(201).json(round);
  } catch (err) {
    console.error("POST /spaces/:id/rounds error:", err);
    res.status(500).json({ error: "회차 생성에 실패했습니다." });
  }
});

router.patch("/spaces/:id/rounds/:roundId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const [callerParticipation] = await db
    .select()
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, req.params.id),
        eq(spaceParticipationsTable.userId, callerId),
        eq(spaceParticipationsTable.role, "OPERATOR"),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    )
    .limit(1);
  if (!callerParticipation) {
    res.status(403).json({ error: "Only operators can update rounds" });
    return;
  }
  const { title, description, status } = req.body;
  const updateFields: Record<string, unknown> = {};
  if (title !== undefined) updateFields.title = title;
  if (description !== undefined) updateFields.description = description;
  if (status !== undefined) updateFields.status = status;
  const [round] = await db
    .update(spaceRoundsTable)
    .set(updateFields)
    .where(
      and(
        eq(spaceRoundsTable.id, req.params.roundId),
        eq(spaceRoundsTable.spaceId, req.params.id),
      ),
    )
    .returning();
  if (!round) {
    res.status(404).json({ error: "Round not found" });
    return;
  }
  res.json(round);
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

router.get("/spaces/:id/code-requests", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const { status } = req.query;
  const [callerParticipation] = await db
    .select()
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, req.params.id),
        eq(spaceParticipationsTable.userId, callerId),
        eq(spaceParticipationsTable.role, "OPERATOR"),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    )
    .limit(1);
  if (!callerParticipation) {
    res.status(403).json({ error: "Only operators can view code requests" });
    return;
  }
  const conditions = [eq(spaceCodeRequestsTable.spaceId, req.params.id)];
  if (status && typeof status === "string") {
    conditions.push(eq(spaceCodeRequestsTable.status, status as "PENDING" | "APPROVED" | "REJECTED" | "CANCELLED"));
  }
  const codeRequests = await db
    .select()
    .from(spaceCodeRequestsTable)
    .where(and(...conditions))
    .orderBy(spaceCodeRequestsTable.createdAt);
  if (codeRequests.length === 0) {
    res.json([]);
    return;
  }
  const requesterIds = [...new Set(codeRequests.map((r) => r.requesterId))];
  const requesters = await db
    .select({ id: usersTable.id, nickname: usersTable.nickname })
    .from(usersTable)
    .where(inArray(usersTable.id, requesterIds));
  const requesterMap = new Map(requesters.map((u) => [u.id, u.nickname]));
  const result = codeRequests.map((r) => ({
    codeRequest: r,
    requesterNickname: requesterMap.get(r.requesterId) ?? null,
  }));
  res.json(result);
});

router.post("/spaces/:id/code-requests", async (req, res) => {
  const [codeRequest] = await db
    .insert(spaceCodeRequestsTable)
    .values({ ...req.body, spaceId: req.params.id })
    .returning();
  res.status(201).json(codeRequest);
});

router.patch("/spaces/:id/code-requests/:requestId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const { status, rejectionReason } = req.body;
  const [callerParticipation] = await db
    .select()
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, req.params.id),
        eq(spaceParticipationsTable.userId, callerId),
        eq(spaceParticipationsTable.role, "OPERATOR"),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    )
    .limit(1);
  if (!callerParticipation) {
    res.status(403).json({ error: "Only operators can approve or reject code requests" });
    return;
  }
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

router.get("/spaces/:id/letters", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const [callerParticipation] = await db
    .select()
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, req.params.id),
        eq(spaceParticipationsTable.userId, callerId),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    )
    .limit(1);
  if (!callerParticipation) {
    res.status(403).json({ error: "Only approved participants can view letters" });
    return;
  }
  const letters = await db
    .select()
    .from(spaceLettersTable)
    .where(eq(spaceLettersTable.spaceId, req.params.id));
  if (letters.length === 0) {
    res.json([]);
    return;
  }
  const articleIds = [...new Set(letters.map((l) => l.sourceArticleId).filter(Boolean) as string[])];
  const authorIds = [...new Set(letters.map((l) => l.authorId))];
  const [articles, authors] = await Promise.all([
    articleIds.length > 0
      ? db
          .select({ id: articlesTable.id, title: articlesTable.title, content: articlesTable.content, cover: articlesTable.cover })
          .from(articlesTable)
          .where(inArray(articlesTable.id, articleIds))
      : Promise.resolve([]),
    authorIds.length > 0
      ? db
          .select({ id: usersTable.id, nickname: usersTable.nickname })
          .from(usersTable)
          .where(inArray(usersTable.id, authorIds))
      : Promise.resolve([]),
  ]);
  const articleMap = new Map(articles.map((a) => [a.id, a]));
  const authorMap = new Map(authors.map((u) => [u.id, u.nickname]));

  // For anonymous spaces: derive a stable pseudonymous display name per author
  // based on the order they joined the space (earliest joiner = "참여자 1", etc.)
  const [space] = await db
    .select({ isAnonymous: spacesTable.isAnonymous })
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id))
    .limit(1);

  let displayNameMap = new Map<string, string>();
  if (space?.isAnonymous) {
    const allAuthorIds = [...new Set(letters.map((l) => l.authorId))];
    const participations = await db
      .select({ userId: spaceParticipationsTable.userId, createdAt: spaceParticipationsTable.createdAt })
      .from(spaceParticipationsTable)
      .where(
        and(
          eq(spaceParticipationsTable.spaceId, req.params.id),
          inArray(spaceParticipationsTable.userId, allAuthorIds),
        ),
      )
      .orderBy(spaceParticipationsTable.createdAt);
    participations.forEach((p, i) => {
      displayNameMap.set(p.userId, `참여자 ${i + 1}`);
    });
  }

  const result = letters.map((letter) => {
    const article = letter.sourceArticleId ? (articleMap.get(letter.sourceArticleId) ?? null) : null;
    const rawContent = article?.content ?? null;
    const articleExcerpt = rawContent ? rawContent.replace(/[#*_`>\-~[\]()]/g, "").trim().slice(0, 100) : null;
    return {
      ...letter,
      articleTitle: article?.title ?? null,
      articleExcerpt,
      articleCover: article?.cover ?? null,
      authorNickname: authorMap.get(letter.authorId) ?? null,
      displayName: displayNameMap.get(letter.authorId) ?? null,
    };
  });
  res.json(result);
});

router.post("/spaces/:id/letters", async (req, res) => {
  const [letter] = await db
    .insert(spaceLettersTable)
    .values({ ...req.body, spaceId: req.params.id })
    .returning();
  res.status(201).json(letter);
});

async function getScheduledSendAccess(spaceId: string, callerId: string) {
  const [participation] = await db
    .select()
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, spaceId),
        eq(spaceParticipationsTable.userId, callerId),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    )
    .limit(1);
  if (!participation) return null;
  return { isOperator: participation.role === "OPERATOR" };
}

async function canManageLetterSends(
  spaceId: string,
  letterId: string,
  callerId: string,
): Promise<boolean> {
  const access = await getScheduledSendAccess(spaceId, callerId);
  if (!access) return false;
  if (access.isOperator) return true;
  const [letter] = await db
    .select()
    .from(spaceLettersTable)
    .where(and(eq(spaceLettersTable.id, letterId), eq(spaceLettersTable.spaceId, spaceId)))
    .limit(1);
  return !!letter && letter.authorId === callerId;
}

router.get("/spaces/:id/letters/:letterId/scheduled-sends", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const allowed = await canManageLetterSends(req.params.id, req.params.letterId, callerId);
  if (!allowed) {
    res.status(403).json({ error: "You can only view scheduled sends for your own letters" });
    return;
  }
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

router.post("/spaces/:id/letters/:letterId/scheduled-sends", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const allowed = await canManageLetterSends(req.params.id, req.params.letterId, callerId);
  if (!allowed) {
    res.status(403).json({ error: "You can only schedule sends for your own letters" });
    return;
  }
  const [send] = await db
    .insert(spaceScheduledSendsTable)
    .values({ ...req.body, spaceId: req.params.id, spaceLetterId: req.params.letterId })
    .returning();
  res.status(201).json(send);
});

router.patch("/spaces/:id/letters/:letterId/scheduled-sends/:sendId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const allowed = await canManageLetterSends(req.params.id, req.params.letterId, callerId);
  if (!allowed) {
    res.status(403).json({ error: "You can only update scheduled sends for your own letters" });
    return;
  }
  const { status, scheduledAt } = req.body;
  const updateFields: Record<string, unknown> = { status };
  if (scheduledAt !== undefined) updateFields.scheduledAt = scheduledAt;
  const [send] = await db
    .update(spaceScheduledSendsTable)
    .set(updateFields)
    .where(
      and(
        eq(spaceScheduledSendsTable.id, req.params.sendId),
        eq(spaceScheduledSendsTable.spaceLetterId, req.params.letterId),
        eq(spaceScheduledSendsTable.spaceId, req.params.id),
      ),
    )
    .returning();
  if (!send) {
    res.status(404).json({ error: "Scheduled send not found" });
    return;
  }
  res.json(send);
});

router.get("/spaces/:id/scheduled-sends", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const access = await getScheduledSendAccess(req.params.id, callerId);
  if (!access) {
    res.status(403).json({ error: "Only space participants can list scheduled sends" });
    return;
  }
  let sends;
  if (access.isOperator) {
    sends = await db
      .select()
      .from(spaceScheduledSendsTable)
      .where(eq(spaceScheduledSendsTable.spaceId, req.params.id))
      .orderBy(spaceScheduledSendsTable.scheduledAt);
  } else {
    const rows = await db
      .select({ send: spaceScheduledSendsTable })
      .from(spaceScheduledSendsTable)
      .innerJoin(
        spaceLettersTable,
        eq(spaceScheduledSendsTable.spaceLetterId, spaceLettersTable.id),
      )
      .where(
        and(
          eq(spaceScheduledSendsTable.spaceId, req.params.id),
          eq(spaceLettersTable.authorId, callerId),
        ),
      )
      .orderBy(spaceScheduledSendsTable.scheduledAt);
    sends = rows.map((r) => r.send);
  }
  if (sends.length === 0) {
    res.json([]);
    return;
  }
  const letterIds = [...new Set(sends.map((s) => s.spaceLetterId))];
  const letters = await db
    .select()
    .from(spaceLettersTable)
    .where(inArray(spaceLettersTable.id, letterIds));
  const letterMap = new Map(letters.map((l) => [l.id, l]));

  const articleIds = [...new Set(letters.map((l) => l.sourceArticleId).filter(Boolean) as string[])];
  const authorIds = [...new Set(letters.map((l) => l.authorId))];

  const [articles, authors] = await Promise.all([
    articleIds.length > 0
      ? db
          .select({ id: articlesTable.id, title: articlesTable.title })
          .from(articlesTable)
          .where(inArray(articlesTable.id, articleIds))
      : Promise.resolve([]),
    authorIds.length > 0
      ? db
          .select({ id: usersTable.id, nickname: usersTable.nickname })
          .from(usersTable)
          .where(inArray(usersTable.id, authorIds))
      : Promise.resolve([]),
  ]);

  const articleMap = new Map(articles.map((a) => [a.id, a.title]));
  const authorMap = new Map(authors.map((u) => [u.id, u.nickname]));

  const result = sends.map((send) => {
    const letter = letterMap.get(send.spaceLetterId) ?? null;
    const articleTitle = letter?.sourceArticleId ? (articleMap.get(letter.sourceArticleId) ?? null) : null;
    const authorNickname = letter ? (authorMap.get(letter.authorId) ?? null) : null;
    return { ...send, letter, articleTitle, authorNickname };
  });

  res.json(result);
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
