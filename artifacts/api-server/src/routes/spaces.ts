import { Router, type IRouter } from "express";
import { eq, and, inArray, count, ne, isNull } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { generateInviteCode } from "../lib/inviteCodeWords";
import { logger } from "../lib/logger";
import { dispatchNotification } from "../lib/notifications";
import { normalizeToKst6, kstDateString, computeDeliverySlot } from "../lib/deliverySlot";
import { processDueScheduledSends } from "../lib/scheduledSendProcessor";
import {
  db,
  spacesTable,
  spaceRoundsTable,
  spaceRoundSlotsTable,
  spaceParticipationsTable,
  spaceInvitationsTable,
  spaceCodeRequestsTable,
  spaceLettersTable,
  spaceScheduledSendsTable,
  usersTable,
  articlesTable,
  userArticleReadsTable,
} from "@workspace/db";

const router: IRouter = Router();

function toDate(val: unknown): Date | undefined {
  if (val == null) return undefined;
  if (val instanceof Date) return val;
  const d = new Date(val as string);
  return isNaN(d.getTime()) ? undefined : d;
}

// ─── Round start date calculation ────────────────────────────────────────────

/**
 * Calculate the scheduled start date for a round (0-indexed) given the start
 * time and the schedule config (N_DAY or WEEKDAY).
 */
function calculateRoundStartDate(
  startedAt: Date,
  scheduleType: "N_DAY" | "WEEKDAY",
  intervalDays: number,
  weekdays: number[],
  roundIndex: number,
): Date | null {
  if (scheduleType === "N_DAY") {
    const date = new Date(startedAt);
    date.setDate(date.getDate() + roundIndex * intervalDays);
    return date;
  }
  if (scheduleType === "WEEKDAY" && weekdays.length > 0) {
    const sorted = [...weekdays].sort((a, b) => a - b);
    const date = new Date(startedAt);
    date.setHours(0, 0, 0, 0);
    let found = 0;
    for (let attempt = 0; attempt < 3650; attempt++) {
      if (sorted.includes(date.getDay())) {
        if (found === roundIndex) return new Date(date);
        found++;
      }
      date.setDate(date.getDate() + 1);
    }
  }
  return null;
}

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
  const MAX_RETRIES = 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const inviteCode: string = body.inviteCode ?? generateInviteCode();
    try {
      // Accept plannedStartsAt (new) or startsAt (legacy) for backward compat
      const { plannedStartsAt, startsAt, ...rest } = body;
      const resolvedPlannedStartsAt = plannedStartsAt ?? startsAt;
      const values = {
        ...rest,
        inviteCode,
        ...(resolvedPlannedStartsAt != null ? { plannedStartsAt: toDate(resolvedPlannedStartsAt) } : {}),
      };
      const [space] = await db.insert(spacesTable).values(values).returning();
      await db.insert(spaceParticipationsTable).values({
        spaceId: space.id,
        userId: body.creatorId,
        role: "OPERATOR",
        status: "APPROVED",
      });
      res.status(201).json(space);
      return;
    } catch (err: unknown) {
      const pg = err as { code?: string };
      if (pg.code === "23505" && !body.inviteCode) {
        lastErr = err;
        continue;
      }
      console.error("POST /spaces error:", err);
      res.status(500).json({ error: "공간 생성에 실패했습니다." });
      return;
    }
  }
  console.error("POST /spaces: invite code collision after max retries", lastErr);
  res.status(500).json({ error: "공간 생성에 실패했습니다." });
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

// ─── Start a space (operator only) ───────────────────────────────────────────

const startSpaceRoundSchema = z.object({
  title: z.string().max(100).nullish(),
  description: z.string().nullish(),
  slots: z.array(z.string().uuid()).default([]),
});

const startSpaceBodySchema = z.object({
  roundCount: z.number().int().min(1),
  scheduleType: z.enum(["N_DAY", "WEEKDAY"]),
  interval: z.number().int().min(1).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  defaultCenterCount: z.number().int().min(1).optional(),
  rounds: z.array(startSpaceRoundSchema).optional(),
  operatorParticipates: z.boolean().default(true),
});

router.post("/spaces/:id/start", requireAuth, async (req, res) => {
  const callerId = req.user!.id;

  // 1. Verify operator
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
    res.status(403).json({ error: "Only operators can start a space" });
    return;
  }

  // 2. Get current space
  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id));
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  if (space.status !== "RECRUITING") {
    res.status(400).json({ error: "이미 시작되었거나 보관된 공간입니다." });
    return;
  }

  // 3. Check opening letter exists
  const [openingLetter] = await db
    .select({ id: spaceLettersTable.id })
    .from(spaceLettersTable)
    .where(
      and(
        eq(spaceLettersTable.spaceId, req.params.id),
        eq(spaceLettersTable.letterType, "OPENING"),
      ),
    )
    .limit(1);
  if (!openingLetter) {
    res.status(400).json({ error: "여는 편지를 먼저 작성해야 합니다." });
    return;
  }

  // 4. Check confirmed participants (non-operator)
  const [{ value: confirmedParticipantCount }] = await db
    .select({ value: count() })
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, req.params.id),
        eq(spaceParticipationsTable.status, "APPROVED"),
        ne(spaceParticipationsTable.role, "OPERATOR"),
      ),
    );
  if (Number(confirmedParticipantCount) === 0) {
    res.status(400).json({ error: "확정된 참여자가 없습니다." });
    return;
  }

  // 5. Validate request body
  const parseResult = startSpaceBodySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: "잘못된 요청입니다.", details: parseResult.error.issues });
    return;
  }
  const body = parseResult.data;

  if (body.scheduleType === "N_DAY" && !body.interval) {
    res.status(400).json({ error: "N_DAY 방식은 interval(일수)이 필요합니다." });
    return;
  }
  if (body.scheduleType === "WEEKDAY" && (!body.weekdays || body.weekdays.length === 0)) {
    res.status(400).json({ error: "WEEKDAY 방식은 weekdays 배열이 필요합니다." });
    return;
  }

  // 6. Fetch approved participants to validate slot assignments
  const approvedParticipations = await db
    .select({ userId: spaceParticipationsTable.userId, role: spaceParticipationsTable.role })
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, req.params.id),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    );
  const approvedUserIds = new Set(approvedParticipations.map((p) => p.userId));

  // Validate and filter slot assignments:
  // - operatorParticipates=false: silently remove operator from all slot lists
  // - All remaining slot user IDs must be approved space participants
  const effectiveRounds = (body.rounds ?? []).map((round, i) => {
    let slots = round.slots ?? [];
    if (!body.operatorParticipates) {
      slots = slots.filter((uid) => uid !== callerId);
    }
    const invalidSlotIds = slots.filter((uid) => !approvedUserIds.has(uid));
    if (invalidSlotIds.length > 0) {
      return { error: `회차 ${i + 1}에 공간 참여자가 아닌 사용자가 포함되어 있습니다: ${invalidSlotIds.join(", ")}` };
    }
    return { ...round, slots };
  });

  const firstError = effectiveRounds.find((r) => "error" in r);
  if (firstError && "error" in firstError) {
    res.status(400).json({ error: firstError.error });
    return;
  }

  if (effectiveRounds.length < body.roundCount) {
    res.status(400).json({
      error: `rounds 배열 길이(${effectiveRounds.length})가 roundCount(${body.roundCount})보다 짧습니다.`,
    });
    return;
  }

  // 7. Execute in a transaction
  const now = new Date();
  const intervalDays = body.interval ?? space.defaultCenterInterval;
  const weekdays = body.weekdays ?? [];
  let rejectedRequesterIds: string[] = [];

  let alreadyStarted = false;
  try {
    await db.transaction(async (tx) => {
      // Conditionally flip RECRUITING -> ACTIVE. This is atomic at the row
      // level, so if two start requests race (e.g. a double-tap), only one
      // UPDATE affects a row; the other affects zero rows and we bail out
      // instead of proceeding to create duplicate rounds/slots.
      const updatedRows = await tx
        .update(spacesTable)
        .set({
          status: "ACTIVE",
          startedAt: now,
          scheduleType: body.scheduleType,
          weekdays: body.weekdays ?? null,
          operatorParticipates: body.operatorParticipates,
          roundCount: body.roundCount,
          ...(body.defaultCenterCount != null ? { defaultCenterCount: body.defaultCenterCount } : {}),
        })
        .where(
          and(
            eq(spacesTable.id, req.params.id),
            eq(spacesTable.status, "RECRUITING"),
          ),
        )
        .returning({ id: spacesTable.id });
      if (updatedRows.length === 0) {
        alreadyStarted = true;
        return;
      }

      // A RECRUITING space can already have rounds (and their slots) created
      // ahead of time — either by the seed data or via POST
      // /spaces/:id/rounds. Since the space was still RECRUITING, none of
      // that data can be in progress (no active round, no letters tied to a
      // round yet), so it's safe to clear it and rebuild from the start
      // request body, which is meant to be the final source of truth.
      // Deleting a round cascades to its slots (space_round_slots has
      // onDelete: "cascade" on space_round_id).
      await tx
        .delete(spaceRoundsTable)
        .where(eq(spaceRoundsTable.spaceId, req.params.id));

      // Create rounds and slots
      let firstRoundId: string | null = null;
      for (let i = 0; i < body.roundCount; i++) {
        const roundConfig = effectiveRounds[i] as Exclude<typeof effectiveRounds[number], { error: string }>;
        const roundStartDate = calculateRoundStartDate(
          now,
          body.scheduleType,
          intervalDays,
          weekdays,
          i,
        );

        const [round] = await tx
          .insert(spaceRoundsTable)
          .values({
            spaceId: req.params.id,
            roundNumber: i + 1,
            title: roundConfig?.title ?? null,
            description: roundConfig?.description ?? null,
            ...(roundStartDate ? { startsAt: roundStartDate } : {}),
          })
          .returning();
        if (i === 0) firstRoundId = round.id;

        // Create slots for this round (already filtered for operator if needed)
        const slots = roundConfig?.slots ?? [];
        for (let j = 0; j < slots.length; j++) {
          await tx.insert(spaceRoundSlotsTable).values({
            spaceRoundId: round.id,
            assignedUserId: slots[j],
            slotOrder: j,
          });
        }
      }

      // Link round-less OPENING letters to round 1. The start flow creates
      // (or reuses) the opening letter before any rounds exist, so it has no
      // spaceRoundId — but the detail screen groups letters strictly by
      // round, so an unlinked letter would never be shown. Attaching it here
      // covers both the newly-created and the reused-letter paths.
      if (firstRoundId) {
        await tx
          .update(spaceLettersTable)
          .set({ spaceRoundId: firstRoundId })
          .where(
            and(
              eq(spaceLettersTable.spaceId, req.params.id),
              eq(spaceLettersTable.letterType, "OPENING"),
              isNull(spaceLettersTable.spaceRoundId),
            ),
          );
      }

      // Reject all pending code requests and collect requester IDs for notification
      const rejected = await tx
        .update(spaceCodeRequestsTable)
        .set({
          status: "REJECTED",
          rejectionReason: "공간이 시작되어 더 이상 코드 신청을 받지 않습니다.",
        })
        .where(
          and(
            eq(spaceCodeRequestsTable.spaceId, req.params.id),
            eq(spaceCodeRequestsTable.status, "PENDING"),
          ),
        )
        .returning({ requesterId: spaceCodeRequestsTable.requesterId });
      rejectedRequesterIds = rejected.map((r) => r.requesterId);
    });
  } catch (err) {
    // Postgres errors (via node-postgres) carry structured fields beyond
    // `message`/`stack` — code, table, column, constraint, detail — which are
    // essential for diagnosing schema mismatches (missing column/table/enum
    // value) without guessing from a generic 500 response. Drizzle wraps the
    // raw pg error in a DrizzleQueryError, so the structured fields live on
    // `err.cause`, not on `err` itself.
    type PgErrorShape = {
      code?: string;
      detail?: string;
      table?: string;
      column?: string;
      constraint?: string;
      schema?: string;
      routine?: string;
      cause?: unknown;
    };
    const topErr = err as PgErrorShape;
    const pgErr: PgErrorShape =
      topErr.code != null ? topErr : ((topErr.cause as PgErrorShape) ?? {});
    console.error("POST /spaces/:id/start transaction error:", {
      message: err instanceof Error ? err.message : String(err),
      stack: err instanceof Error ? err.stack : undefined,
      code: pgErr.code,
      detail: pgErr.detail,
      table: pgErr.table,
      column: pgErr.column,
      constraint: pgErr.constraint,
      schema: pgErr.schema,
      routine: pgErr.routine,
      spaceId: req.params.id,
      callerId,
    });
    // Surface the concrete DB failure reason (not just a generic message) so
    // operators/testers can see exactly what went wrong instead of guessing
    // from a bare "공간 시작에 실패했습니다." — this app is still being
    // debugged in the field, so precise diagnostics beat a clean but useless
    // error message.
    const detailParts = [
      pgErr.code ? `code=${pgErr.code}` : undefined,
      pgErr.table ? `table=${pgErr.table}` : undefined,
      pgErr.column ? `column=${pgErr.column}` : undefined,
      pgErr.constraint ? `constraint=${pgErr.constraint}` : undefined,
      pgErr.detail,
    ].filter(Boolean);
    const detail = detailParts.length > 0
      ? detailParts.join(", ")
      : (err instanceof Error ? err.message : String(err));
    res.status(500).json({ error: "공간 시작에 실패했습니다.", detail });
    return;
  }

  if (alreadyStarted) {
    res.status(409).json({ error: "이미 시작되었거나 보관된 공간입니다." });
    return;
  }

  // Dispatch rejection notifications for auto-rejected code requesters
  for (const requesterId of rejectedRequesterIds) {
    dispatchNotification({
      type: "SPACE_CODE_REQUEST_AUTO_REJECTED",
      spaceId: req.params.id,
      requesterId,
      rejectionReason: "공간이 시작되어 더 이상 코드 신청을 받지 않습니다.",
    });
  }

  // Return updated space
  const [updatedSpace] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id));
  res.json(updatedSpace);
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
    const { startsAt, endsAt, ...rest } = req.body;
    const values = {
      ...rest,
      spaceId: req.params.id,
      ...(startsAt != null ? { startsAt: toDate(startsAt) } : {}),
      ...(endsAt != null ? { endsAt: toDate(endsAt) } : {}),
    };
    const [round] = await db
      .insert(spaceRoundsTable)
      .values(values)
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

// ─── Slot CRUD ────────────────────────────────────────────────────────────────

async function requireSpaceOperator(spaceId: string, callerId: string, res: any): Promise<boolean> {
  const [participation] = await db
    .select()
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, spaceId),
        eq(spaceParticipationsTable.userId, callerId),
        eq(spaceParticipationsTable.role, "OPERATOR"),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    )
    .limit(1);
  if (!participation) {
    res.status(403).json({ error: "Only operators can manage slots" });
    return false;
  }
  return true;
}

/** Validate that roundId belongs to the given spaceId. Returns null and sends 404 on failure. */
async function requireRoundInSpace(
  spaceId: string,
  roundId: string,
  res: any,
): Promise<(typeof spaceRoundsTable.$inferSelect) | null> {
  const [round] = await db
    .select()
    .from(spaceRoundsTable)
    .where(
      and(
        eq(spaceRoundsTable.id, roundId),
        eq(spaceRoundsTable.spaceId, spaceId),
      ),
    )
    .limit(1);
  if (!round) {
    res.status(404).json({ error: "Round not found in this space" });
    return null;
  }
  return round;
}

async function enrichSlots(slots: (typeof spaceRoundSlotsTable.$inferSelect)[]) {
  if (slots.length === 0) return [];
  const userIds = [...new Set(slots.map((s) => s.assignedUserId))];
  const users = await db
    .select({ id: usersTable.id, nickname: usersTable.nickname })
    .from(usersTable)
    .where(inArray(usersTable.id, userIds));
  const userMap = new Map(users.map((u) => [u.id, u.nickname]));
  return slots.map((slot) => ({
    ...slot,
    assignedUserNickname: userMap.get(slot.assignedUserId) ?? null,
  }));
}

router.get("/spaces/:id/rounds/:roundId/slots", async (req, res) => {
  const round = await requireRoundInSpace(req.params.id, req.params.roundId, res);
  if (!round) return;
  const slots = await db
    .select()
    .from(spaceRoundSlotsTable)
    .where(eq(spaceRoundSlotsTable.spaceRoundId, req.params.roundId))
    .orderBy(spaceRoundSlotsTable.slotOrder, spaceRoundSlotsTable.createdAt);
  res.json(await enrichSlots(slots));
});

router.post("/spaces/:id/rounds/:roundId/slots", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const allowed = await requireSpaceOperator(req.params.id, callerId, res);
  if (!allowed) return;
  const round = await requireRoundInSpace(req.params.id, req.params.roundId, res);
  if (!round) return;
  const { assignedUserId, slotOrder, scheduledDate } = req.body;
  const [slot] = await db
    .insert(spaceRoundSlotsTable)
    .values({
      spaceRoundId: req.params.roundId,
      assignedUserId,
      slotOrder: slotOrder ?? 0,
      scheduledDate: scheduledDate ?? null,
    })
    .returning();
  const enriched = await enrichSlots([slot]);
  res.status(201).json(enriched[0]);
});

router.patch("/spaces/:id/rounds/:roundId/slots/:slotId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const allowed = await requireSpaceOperator(req.params.id, callerId, res);
  if (!allowed) return;
  const round = await requireRoundInSpace(req.params.id, req.params.roundId, res);
  if (!round) return;
  const { assignedUserId, slotOrder, scheduledDate } = req.body;
  const updateFields: Record<string, unknown> = {};
  if (assignedUserId !== undefined) updateFields.assignedUserId = assignedUserId;
  if (slotOrder !== undefined) updateFields.slotOrder = slotOrder;
  if (scheduledDate !== undefined) updateFields.scheduledDate = scheduledDate;
  const [slot] = await db
    .update(spaceRoundSlotsTable)
    .set(updateFields)
    .where(
      and(
        eq(spaceRoundSlotsTable.id, req.params.slotId),
        eq(spaceRoundSlotsTable.spaceRoundId, req.params.roundId),
      ),
    )
    .returning();
  if (!slot) {
    res.status(404).json({ error: "Slot not found" });
    return;
  }
  const enriched = await enrichSlots([slot]);
  res.json(enriched[0]);
});

router.delete("/spaces/:id/rounds/:roundId/slots/:slotId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const allowed = await requireSpaceOperator(req.params.id, callerId, res);
  if (!allowed) return;
  const round = await requireRoundInSpace(req.params.id, req.params.roundId, res);
  if (!round) return;
  const [slot] = await db
    .delete(spaceRoundSlotsTable)
    .where(
      and(
        eq(spaceRoundSlotsTable.id, req.params.slotId),
        eq(spaceRoundSlotsTable.spaceRoundId, req.params.roundId),
      ),
    )
    .returning();
  if (!slot) {
    res.status(404).json({ error: "Slot not found" });
    return;
  }
  res.status(204).send();
});

// ─── Space Members (with nicknames, for slot assignment) ──────────────────────

router.get("/spaces/:id/members", async (req, res) => {
  const participations = await db
    .select({
      userId: spaceParticipationsTable.userId,
      role: spaceParticipationsTable.role,
      status: spaceParticipationsTable.status,
      nickname: usersTable.nickname,
    })
    .from(spaceParticipationsTable)
    .innerJoin(usersTable, eq(spaceParticipationsTable.userId, usersTable.id))
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, req.params.id),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    );
  res.json(participations);
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
  const isOperator = callerParticipation.role === "OPERATOR";

  // Catch up any reservation whose scheduledAt has passed but hasn't been
  // processed by the periodic sweep yet, so gating below reflects reality.
  await processDueScheduledSends({ spaceId: req.params.id });

  let letters = await db
    .select()
    .from(spaceLettersTable)
    .where(eq(spaceLettersTable.spaceId, req.params.id));
  if (letters.length === 0) {
    res.json([]);
    return;
  }

  // Gate visibility: a letter authored by someone else is hidden from other
  // participants until its CURRENT reservation's time has actually arrived.
  // "Current" means the most recently created non-cancelled reservation for
  // that letter — a letter that was already SENT once but has since been
  // re-reserved (e.g. re-sent to a later date) must go back to hidden until
  // the new date arrives; an old SENT record must not keep it visible.
  // Letters with no reservation at all (never scheduled) remain immediately
  // visible, matching prior behavior. Operators and the letter's own author
  // always see it regardless of reservation state.
  if (!isOperator) {
    const otherLetterIds = letters.filter((l) => l.authorId !== callerId).map((l) => l.id);
    if (otherLetterIds.length > 0) {
      const sends = await db
        .select({
          spaceLetterId: spaceScheduledSendsTable.spaceLetterId,
          status: spaceScheduledSendsTable.status,
          scheduledAt: spaceScheduledSendsTable.scheduledAt,
          createdAt: spaceScheduledSendsTable.createdAt,
        })
        .from(spaceScheduledSendsTable)
        .where(inArray(spaceScheduledSendsTable.spaceLetterId, otherLetterIds));

      const now = new Date();
      const hiddenLetterIds = new Set<string>();
      const sendsByLetter = new Map<string, typeof sends>();
      for (const s of sends) {
        const bucket = sendsByLetter.get(s.spaceLetterId) ?? [];
        bucket.push(s);
        sendsByLetter.set(s.spaceLetterId, bucket);
      }
      for (const [letterId, letterSends] of sendsByLetter) {
        const activeSends = letterSends.filter((s) => s.status !== "CANCELLED");
        if (activeSends.length === 0) continue; // only cancelled reservations exist — treat as unscheduled
        const current = activeSends.reduce((latest, s) =>
          new Date(s.createdAt) > new Date(latest.createdAt) ? s : latest,
        );
        const isVisible =
          current.status === "SENT" || (current.status === "PENDING" && new Date(current.scheduledAt) <= now);
        if (!isVisible) hiddenLetterIds.add(letterId);
      }
      if (hiddenLetterIds.size > 0) {
        letters = letters.filter((l) => l.authorId === callerId || !hiddenLetterIds.has(l.id));
      }
    }
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

  // Fetch read status for the calling user across all letter articles
  const readArticleIds = articleIds.length > 0
    ? await db
        .select({ articleId: userArticleReadsTable.articleId })
        .from(userArticleReadsTable)
        .where(and(
          eq(userArticleReadsTable.userId, callerId),
          inArray(userArticleReadsTable.articleId, articleIds),
        ))
    : [];
  const readSet = new Set(readArticleIds.map((r) => r.articleId));

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
      isRead: letter.sourceArticleId ? readSet.has(letter.sourceArticleId) : false,
    };
  });
  res.json(result);
});

router.post("/spaces/:id/letters", requireAuth, async (req, res) => {
  const bodySchema = z.object({
    sourceArticleId: z.string().uuid().nullable().optional(),
    spaceRoundId: z.string().uuid().nullable().optional(),
    letterType: z.enum(["OPENING", "CENTER", "REPLY"]),
    isPublic: z.boolean().optional(),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  // Require approved membership in the target space.
  const [participation] = await db
    .select()
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, req.params.id),
        eq(spaceParticipationsTable.userId, req.user!.id),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    )
    .limit(1);
  if (!participation) {
    res.status(403).json({ error: "Not a member of this space" });
    return;
  }

  // Opening letters "open" a round for everyone in the space, so only an
  // operator may author/reserve one — unlike CENTER letters, which any
  // participant may write for their own assigned slot.
  if (parsed.data.letterType === "OPENING" && participation.role !== "OPERATOR") {
    res.status(403).json({ error: "여는 편지는 운영자만 작성할 수 있습니다." });
    return;
  }

  // If a sourceArticleId is provided, reuse any existing SpaceLetter for
  // (space, article, author, round) instead of creating a duplicate. The
  // round is part of the matching key so that, e.g., reusing the same
  // article as an OPENING letter for round 2 doesn't accidentally pick up
  // round 1's letter row for that article.
  if (parsed.data.sourceArticleId) {
    const [existing] = await db
      .select()
      .from(spaceLettersTable)
      .where(
        and(
          eq(spaceLettersTable.spaceId, req.params.id),
          eq(spaceLettersTable.sourceArticleId, parsed.data.sourceArticleId),
          eq(spaceLettersTable.authorId, req.user!.id),
          parsed.data.spaceRoundId
            ? eq(spaceLettersTable.spaceRoundId, parsed.data.spaceRoundId)
            : isNull(spaceLettersTable.spaceRoundId),
        ),
      )
      .limit(1);
    if (existing) {
      res.status(200).json(existing);
      return;
    }
  }

  const [letter] = await db
    .insert(spaceLettersTable)
    .values({ ...parsed.data, spaceId: req.params.id, authorId: req.user!.id })
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
  // Defensive: catch up any reservation for this space whose scheduledAt has
  // passed but hasn't been processed by the periodic sweep yet, so it never
  // shows as "대기 중" (pending) after its time has come.
  await processDueScheduledSends({ spaceId: req.params.id });
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

/**
 * Finds the round slot assigned to `authorId` within `spaceRoundId`, if any.
 */
async function findAssignedSlot(spaceRoundId: string, authorId: string) {
  const [slot] = await db
    .select()
    .from(spaceRoundSlotsTable)
    .where(
      and(
        eq(spaceRoundSlotsTable.spaceRoundId, spaceRoundId),
        eq(spaceRoundSlotsTable.assignedUserId, authorId),
      ),
    )
    .limit(1);
  return slot ?? null;
}

/**
 * Validates that a CENTER-role reservation's requested date matches the
 * author's assigned slot date for that round. Returns an error message
 * string on failure, or null on success (also returning the matched slot so
 * callers can persist its id).
 */
type CenterSlotValidation =
  | { ok: true; slot: typeof spaceRoundSlotsTable.$inferSelect }
  | { ok: false; error: string };

async function validateCenterSlotDate(
  letter: { spaceRoundId: string | null; authorId: string },
  normalizedScheduledAt: Date | undefined,
): Promise<CenterSlotValidation> {
  if (!letter.spaceRoundId) {
    return { ok: false, error: "회차 정보가 없는 글은 예약할 수 없습니다." };
  }
  const slot = await findAssignedSlot(letter.spaceRoundId, letter.authorId);
  if (!slot) {
    return { ok: false, error: "이 회차에 배정된 슬롯이 없습니다." };
  }
  if (!slot.scheduledDate) {
    return { ok: false, error: "슬롯에 배정된 발송일이 없습니다." };
  }
  if (normalizedScheduledAt && kstDateString(normalizedScheduledAt) !== slot.scheduledDate) {
    return { ok: false, error: "요청한 발송 예정일이 배정된 슬롯 날짜와 일치하지 않습니다." };
  }
  return { ok: true, slot };
}

/**
 * Validates that an OPENING-role reservation's requested date is on or
 * before the letter's round's start date — an opening letter "opens" the
 * round, so it can never be scheduled after the round has already started.
 * Returns an error message string on failure, or null on success.
 */
type OpeningRoundValidation = { ok: true } | { ok: false; error: string };

async function validateOpeningRoundDate(
  letter: { spaceRoundId: string | null },
  normalizedScheduledAt: Date | undefined,
): Promise<OpeningRoundValidation> {
  if (!letter.spaceRoundId) {
    return { ok: false, error: "회차 정보가 없는 여는 편지는 예약할 수 없습니다." };
  }
  const [round] = await db
    .select()
    .from(spaceRoundsTable)
    .where(eq(spaceRoundsTable.id, letter.spaceRoundId))
    .limit(1);
  if (!round) {
    return { ok: false, error: "회차 정보를 찾을 수 없습니다." };
  }
  if (!round.startsAt) {
    return { ok: false, error: "회차 시작일 정보가 없어 여는 편지를 예약할 수 없습니다." };
  }
  // Mirrors the client's getMinOpeningDate(): before 06:00 KST, today is
  // still a valid earliest date; at/after 06:00 KST, only tomorrow onward.
  // computeDeliverySlot() already encodes exactly this cutoff.
  const minAllowedDate = kstDateString(computeDeliverySlot());
  if (normalizedScheduledAt && kstDateString(normalizedScheduledAt) < minAllowedDate) {
    return { ok: false, error: "선택한 날짜는 더 이상 예약할 수 없어요. 다른 날짜를 선택해주세요." };
  }
  if (normalizedScheduledAt && kstDateString(normalizedScheduledAt) > kstDateString(round.startsAt)) {
    return { ok: false, error: "여는 편지는 회차 시작일 이전까지만 예약할 수 있어요." };
  }
  return { ok: true };
}

router.post("/spaces/:id/letters/:letterId/scheduled-sends", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const allowed = await canManageLetterSends(req.params.id, req.params.letterId, callerId);
  if (!allowed) {
    res.status(403).json({ error: "You can only schedule sends for your own letters" });
    return;
  }

  const [letter] = await db
    .select()
    .from(spaceLettersTable)
    .where(
      and(
        eq(spaceLettersTable.id, req.params.letterId),
        eq(spaceLettersTable.spaceId, req.params.id),
      ),
    )
    .limit(1);
  if (!letter) {
    res.status(404).json({ error: "Letter not found" });
    return;
  }

  const { scheduledAt, slotId, ...sendRest } = req.body;
  if (scheduledAt == null) {
    res.status(400).json({ error: "scheduledAt is required" });
    return;
  }
  const parsedScheduledAt = toDate(scheduledAt);
  if (!parsedScheduledAt) {
    res.status(400).json({ error: "잘못된 발송 시각입니다." });
    return;
  }
  // Reservation send times are always normalized to KST 06:00, regardless of
  // whatever date/time value the client actually sent.
  const normalizedScheduledAt = normalizeToKst6(parsedScheduledAt);

  // Reject duplicate PENDING reservations for the same author/space/round/role.
  const dupConditions = [
    eq(spaceScheduledSendsTable.spaceId, req.params.id),
    eq(spaceScheduledSendsTable.status, "PENDING"),
    eq(spaceLettersTable.authorId, letter.authorId),
    eq(spaceLettersTable.letterType, letter.letterType),
    letter.spaceRoundId
      ? eq(spaceLettersTable.spaceRoundId, letter.spaceRoundId)
      : isNull(spaceLettersTable.spaceRoundId),
  ];
  const [duplicate] = await db
    .select({ id: spaceScheduledSendsTable.id })
    .from(spaceScheduledSendsTable)
    .innerJoin(spaceLettersTable, eq(spaceScheduledSendsTable.spaceLetterId, spaceLettersTable.id))
    .where(and(...dupConditions))
    .limit(1);
  if (duplicate) {
    res.status(409).json({ error: "이미 같은 회차·역할로 대기 중인 예약이 있습니다." });
    return;
  }

  let resolvedSlotId: string | undefined = slotId ?? undefined;
  if (letter.letterType === "CENTER") {
    const validation = await validateCenterSlotDate(letter, normalizedScheduledAt);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
    resolvedSlotId = validation.slot.id;
  } else if (letter.letterType === "OPENING") {
    const validation = await validateOpeningRoundDate(letter, normalizedScheduledAt);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
  }

  const [send] = await db
    .insert(spaceScheduledSendsTable)
    .values({
      ...sendRest,
      spaceId: req.params.id,
      spaceLetterId: req.params.letterId,
      scheduledAt: normalizedScheduledAt,
      ...(resolvedSlotId != null ? { slotId: resolvedSlotId } : {}),
    })
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
  if (scheduledAt !== undefined) {
    const parsedScheduledAt = toDate(scheduledAt);
    if (!parsedScheduledAt) {
      res.status(400).json({ error: "잘못된 발송 시각입니다." });
      return;
    }
    const normalizedScheduledAt = normalizeToKst6(parsedScheduledAt);

    const [letter] = await db
      .select()
      .from(spaceLettersTable)
      .where(
        and(
          eq(spaceLettersTable.id, req.params.letterId),
          eq(spaceLettersTable.spaceId, req.params.id),
        ),
      )
      .limit(1);
    if (letter?.letterType === "CENTER") {
      const validation = await validateCenterSlotDate(letter, normalizedScheduledAt);
      if (!validation.ok) {
        res.status(400).json({ error: validation.error });
        return;
      }
      updateFields.slotId = validation.slot.id;
    } else if (letter?.letterType === "OPENING") {
      const validation = await validateOpeningRoundDate(letter, normalizedScheduledAt);
      if (!validation.ok) {
        res.status(400).json({ error: validation.error });
        return;
      }
    }
    updateFields.scheduledAt = normalizedScheduledAt;
  }
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
  // Defensive: catch up any reservation whose scheduledAt has passed but
  // hasn't been processed by the periodic sweep yet, so it never shows as
  // "대기 중" (pending) after its time has come.
  await processDueScheduledSends({ spaceId: req.params.id });
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
  const roundIds = [...new Set(letters.map((l) => l.spaceRoundId).filter(Boolean) as string[])];
  const slotIds = [...new Set(sends.map((s) => s.slotId).filter(Boolean) as string[])];

  const [articles, authors, space, rounds, slots] = await Promise.all([
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
    db.select().from(spacesTable).where(eq(spacesTable.id, req.params.id)).then((r) => r[0] ?? null),
    roundIds.length > 0
      ? db.select().from(spaceRoundsTable).where(inArray(spaceRoundsTable.id, roundIds))
      : Promise.resolve([]),
    slotIds.length > 0
      ? db.select().from(spaceRoundSlotsTable).where(inArray(spaceRoundSlotsTable.id, slotIds))
      : Promise.resolve([]),
  ]);

  const articleMap = new Map(articles.map((a) => [a.id, a.title]));
  const authorMap = new Map(authors.map((u) => [u.id, u.nickname]));
  const roundMap = new Map(rounds.map((r) => [r.id, r]));
  const slotMap = new Map(slots.map((s) => [s.id, s]));

  // Fallback slot lookup for sends created before slotId was auto-populated
  // (or without one on record): resolve via round + author assignment.
  const missingRoundAuthorPairs = letters
    .filter((l) => l.letterType === "CENTER" && l.spaceRoundId)
    .map((l) => ({ spaceRoundId: l.spaceRoundId as string, authorId: l.authorId }));
  const fallbackSlots =
    missingRoundAuthorPairs.length > 0
      ? await db
          .select()
          .from(spaceRoundSlotsTable)
          .where(
            inArray(
              spaceRoundSlotsTable.spaceRoundId,
              [...new Set(missingRoundAuthorPairs.map((p) => p.spaceRoundId))],
            ),
          )
      : [];
  const fallbackSlotMap = new Map(
    fallbackSlots.map((s) => [`${s.spaceRoundId}:${s.assignedUserId}`, s]),
  );

  const result = sends.map((send) => {
    const letter = letterMap.get(send.spaceLetterId) ?? null;
    const articleTitle = letter?.sourceArticleId ? (articleMap.get(letter.sourceArticleId) ?? null) : null;
    const authorNickname = letter ? (authorMap.get(letter.authorId) ?? null) : null;

    const round = letter?.spaceRoundId ? (roundMap.get(letter.spaceRoundId) ?? null) : null;
    const slot =
      (send.slotId ? slotMap.get(send.slotId) : null) ??
      (letter?.spaceRoundId
        ? (fallbackSlotMap.get(`${letter.spaceRoundId}:${letter.authorId}`) ?? null)
        : null);

    return {
      ...send,
      letter,
      articleTitle,
      authorNickname,
      roundNumber: round?.roundNumber ?? null,
      totalRounds: space?.roundCount ?? null,
      letterType: letter?.letterType ?? null,
      slotScheduledDate: slot?.scheduledDate ?? null,
    };
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
