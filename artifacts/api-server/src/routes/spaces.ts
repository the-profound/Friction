import { Router, type IRouter, type Response } from "express";
import { eq, and, inArray, count, ne, isNull, isNotNull, asc, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import {
  ANONYMOUS_PARTICIPANT_NAME,
  getAnonymousDisplayName,
  parseAnonymousSpaceNickname,
} from "../lib/anonymousSpaceIdentity";
import { getSpaceCreationDiagnostic } from "../lib/spaceCreationDiagnostics";
import {
  parseSpaceCreationIdentity,
  parseSpaceCreationKey,
} from "../lib/spaceCreationInput";
import { createOrReuseSpace } from "../lib/spaceCreationReplay";
import { redactSpaceCreationKeys } from "../lib/spaceCreationResponse";
import {
  canCreateSpaceRound,
  createOrReuseSpaceRound,
} from "../lib/spaceRoundCreation";
import {
  getSpaceBasicSettingsAccessIssue,
  parseSpaceBasicSettingsInput,
  shouldBlockAnonymousConversion,
} from "../lib/spaceBasicSettings";
import { generateInviteCode } from "../lib/inviteCodeWords";
import { logger } from "../lib/logger";
import { dispatchNotification } from "../lib/notifications";
import {
  normalizeToKst6,
  kstDateString,
  computeDeliverySlot,
  isKstDateReservable,
} from "../lib/deliverySlot";
import {
  calculateOccasionDate,
  calculateSlotOccasionIndex,
} from "../lib/spaceSchedule";
import { processDueScheduledSends } from "../lib/scheduledSendProcessor";
import { getCorrelationId } from "../lib/operationalTelemetry";
import { synchronizeSpaceRoundStatuses } from "../lib/spaceRoundStatus";
import {
  isRecruitmentFull,
  startsConsumingRecruitmentPlace,
} from "../lib/spaceRecruitment";
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
  letterRecipientAccessTable,
  usersTable,
  articlesTable,
  userArticleReadsTable,
} from "@workspace/db";

const router: IRouter = Router();

// A `:id` on this router always denotes a space identifier, which is always a
// UUID. Deployed clients sometimes call routes that don't exist on the
// server build currently running (e.g. a new endpoint that shipped in the
// client ahead of the API deploy); those requests fall through to
// `/spaces/:id` with the unmatched path segment as a non-UUID value, which
// previously threw inside the DB query and surfaced as an HTML 500. Validate
// the shape here — before auth or any route handler runs — so unknown or
// malformed identifiers cleanly 404 with a JSON body instead.
const SPACE_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
router.param("id", (req, res, next, value) => {
  if (typeof value !== "string" || !SPACE_ID_PATTERN.test(value)) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  next();
});

router.use((_req, res, next) => {
  const originalJson = res.json.bind(res);
  res.json = ((body: unknown) => originalJson(redactSpaceCreationKeys(body))) as typeof res.json;
  next();
});

function toDate(val: unknown): Date | undefined {
  if (val == null) return undefined;
  if (val instanceof Date) return val;
  const d = new Date(val as string);
  return isNaN(d.getTime()) ? undefined : d;
}

function getPgError(err: unknown): { code?: string; constraint?: string } {
  const error = err as { code?: string; constraint?: string; cause?: { code?: string; constraint?: string } };
  return error.code ? error : (error.cause ?? {});
}

function isSpaceNicknameConflict(err: unknown): boolean {
  const pg = getPgError(err);
  return pg.code === "23505" && (
    pg.constraint === "space_participations_active_nickname_unique" ||
    pg.constraint === "space_code_requests_active_nickname_unique"
  );
}

type SpaceJoinErrorCode =
  | "INVITE_CODE_MISMATCH"
  | "DUPLICATE_CODE_REQUEST"
  | "MISSING_NICKNAME"
  | "NICKNAME_CONFLICT"
  | "ALREADY_PARTICIPATING"
  | "SPACE_FULL"
  | "SPACE_NOT_RECRUITING"
  | "ALREADY_RESPONDED";

function sendSpaceJoinError(
  res: Response,
  status: number,
  code: SpaceJoinErrorCode,
  error: string,
) {
  res.status(status).json({ error, code });
}

function toSpaceBasicSettingsResponse(
  space: Pick<typeof spacesTable.$inferSelect, "name" | "description" | "isAnonymous">,
) {
  return {
    name: space.name,
    description: space.description,
    isAnonymous: space.isAnonymous,
  };
}

async function getLockedSpaceForNicknameMutation(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  spaceId: string,
) {
  await tx.execute(sql`SELECT id FROM spaces WHERE id = ${spaceId} FOR UPDATE`);
  const [space] = await tx
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, spaceId))
    .limit(1);
  return space;
}

async function getApprovedRecruitParticipantCount(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  spaceId: string,
): Promise<number> {
  const [{ value }] = await tx
    .select({ value: count() })
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, spaceId),
        eq(spaceParticipationsTable.status, "APPROVED"),
        ne(spaceParticipationsTable.role, "OPERATOR"),
      ),
    );
  return Number(value);
}

async function hasReservedSpaceNickname(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  spaceId: string,
  nickname: string,
  options?: { exceptParticipationId?: string; exceptCodeRequestId?: string },
): Promise<boolean> {
  const normalized = nickname.toLocaleLowerCase("ko-KR");
  const participationConditions = [
    eq(spaceParticipationsTable.spaceId, spaceId),
    inArray(spaceParticipationsTable.status, ["PENDING", "APPROVED"]),
    sql`lower(btrim(${spaceParticipationsTable.spaceNickname})) = ${normalized}`,
  ];
  if (options?.exceptParticipationId) {
    participationConditions.push(ne(spaceParticipationsTable.id, options.exceptParticipationId));
  }
  const [participationConflict] = await tx
    .select({ id: spaceParticipationsTable.id })
    .from(spaceParticipationsTable)
    .where(and(...participationConditions))
    .limit(1);
  if (participationConflict) return true;

  const codeRequestConditions = [
    eq(spaceCodeRequestsTable.spaceId, spaceId),
    inArray(spaceCodeRequestsTable.status, ["PENDING", "APPROVED"]),
    sql`lower(btrim(${spaceCodeRequestsTable.spaceNickname})) = ${normalized}`,
  ];
  if (options?.exceptCodeRequestId) {
    codeRequestConditions.push(ne(spaceCodeRequestsTable.id, options.exceptCodeRequestId));
  }
  const [codeRequestConflict] = await tx
    .select({ id: spaceCodeRequestsTable.id })
    .from(spaceCodeRequestsTable)
    .where(and(...codeRequestConditions))
    .limit(1);
  return !!codeRequestConflict;
}

async function getSpaceDisplayNameMap(spaceId: string, userIds: string[]) {
  const uniqueUserIds = [...new Set(userIds)];
  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, spaceId))
    .limit(1);
  const displayNames = new Map<string, string>();
  if (!space || uniqueUserIds.length === 0) return { space: space ?? null, displayNames };

  if (space.isAnonymous) {
    const [participations, codeRequests] = await Promise.all([
      db
        .select({
          userId: spaceParticipationsTable.userId,
          spaceNickname: spaceParticipationsTable.spaceNickname,
        })
        .from(spaceParticipationsTable)
        .where(
          and(
            eq(spaceParticipationsTable.spaceId, spaceId),
            inArray(spaceParticipationsTable.status, ["PENDING", "APPROVED"]),
            inArray(spaceParticipationsTable.userId, uniqueUserIds),
          ),
        ),
      db
        .select({
          userId: spaceCodeRequestsTable.requesterId,
          spaceNickname: spaceCodeRequestsTable.spaceNickname,
        })
        .from(spaceCodeRequestsTable)
        .where(
          and(
            eq(spaceCodeRequestsTable.spaceId, spaceId),
            inArray(spaceCodeRequestsTable.status, ["PENDING", "APPROVED"]),
            inArray(spaceCodeRequestsTable.requesterId, uniqueUserIds),
          ),
        ),
    ]);
    const nicknameByUser = new Map(participations.map((p) => [p.userId, p.spaceNickname]));
    for (const request of codeRequests) {
      if (!nicknameByUser.has(request.userId)) {
        nicknameByUser.set(request.userId, request.spaceNickname);
      }
    }
    for (const userId of uniqueUserIds) {
      displayNames.set(userId, getAnonymousDisplayName(space, nicknameByUser.get(userId)));
    }
  } else {
    const users = await db
      .select({ id: usersTable.id, nickname: usersTable.nickname })
      .from(usersTable)
      .where(inArray(usersTable.id, uniqueUserIds));
    for (const user of users) displayNames.set(user.id, user.nickname);
  }
  return { space, displayNames };
}

function sanitizeParticipationDisplay<
  T extends typeof spaceParticipationsTable.$inferSelect,
>(participation: T, displayName: string | undefined) {
  return {
    ...participation,
    // This field is a presentation value in responses. It never reveals a
    // stored anonymous nickname while the space is recruiting.
    spaceNickname: displayName ?? null,
    displayName: displayName ?? null,
  };
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
  const creatorIds = [...new Set(spaces.map((space) => space.creatorId))];
  const [creators, participantCounts, creatorParticipations] = await Promise.all([
    db
      .select({ id: usersTable.id, nickname: usersTable.nickname })
      .from(usersTable)
      .where(inArray(usersTable.id, creatorIds)),
    db
      .select({ spaceId: spaceParticipationsTable.spaceId, value: count() })
      .from(spaceParticipationsTable)
      .where(
        and(
          inArray(spaceParticipationsTable.spaceId, spaceIds),
          eq(spaceParticipationsTable.status, "APPROVED"),
          ne(spaceParticipationsTable.role, "OPERATOR"),
        ),
      )
      .groupBy(spaceParticipationsTable.spaceId),
    db
      .select({
        spaceId: spaceParticipationsTable.spaceId,
        userId: spaceParticipationsTable.userId,
        spaceNickname: spaceParticipationsTable.spaceNickname,
      })
      .from(spaceParticipationsTable)
      .where(
        and(
          inArray(spaceParticipationsTable.spaceId, spaceIds),
          eq(spaceParticipationsTable.status, "APPROVED"),
        ),
      ),
  ]);
  const creatorMap = Object.fromEntries(creators.map((creator) => [creator.id, creator.nickname]));
  const participantCountMap = Object.fromEntries(
    participantCounts.map((participantCount) => [participantCount.spaceId, participantCount.value]),
  );
  const creatorParticipationMap = new Map(
    creatorParticipations.map((participation) => [
      `${participation.spaceId}:${participation.userId}`,
      participation,
    ]),
  );
  const spaceMap = new Map(spaces.map((s) => [s.id, s]));
  const result = invitations
    .filter((i) => spaceMap.has(i.spaceId))
    .map((i) => {
      const space = spaceMap.get(i.spaceId)!;
      return {
        invitation: i,
        space: {
          ...space,
          creatorNickname: space.isAnonymous
            ? getAnonymousDisplayName(
                space,
                creatorParticipationMap.get(`${space.id}:${space.creatorId}`)?.spaceNickname,
              )
            : (creatorMap[space.creatorId] ?? null),
          participantCount: participantCountMap[space.id] ?? 0,
        },
      };
    });
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
  const displayNamesBySpace = new Map<string, Map<string, string>>();
  await Promise.all(spaces.map(async (space) => {
    const requesterIds = codeRequests
      .filter((request) => request.spaceId === space.id)
      .map((request) => request.requesterId);
    const { displayNames } = await getSpaceDisplayNameMap(space.id, requesterIds);
    displayNamesBySpace.set(space.id, displayNames);
  }));
  const result = codeRequests
    .filter((r) => spaceMap.has(r.spaceId))
    .map((r) => ({
      codeRequest: {
        ...r,
        spaceNickname: displayNamesBySpace.get(r.spaceId)?.get(r.requesterId) ?? null,
      },
      space: spaceMap.get(r.spaceId)!,
    }));
  res.json(result);
});

// ─── Operator pending code requests (must be before /:id) ────────────────────
router.get("/spaces/operator-pending-code-requests", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const operatorParticipations = await db
    .select({ spaceId: spaceParticipationsTable.spaceId })
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.userId, callerId),
        eq(spaceParticipationsTable.role, "OPERATOR"),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    );

  const operatorSpaceIds = [...new Set(operatorParticipations.map((p) => p.spaceId))];
  if (operatorSpaceIds.length === 0) {
    res.json([]);
    return;
  }

  const [spaces, pendingCounts] = await Promise.all([
    db
      .select()
      .from(spacesTable)
      .where(
        and(
          inArray(spacesTable.id, operatorSpaceIds),
          ne(spacesTable.status, "ARCHIVED"),
        ),
      ),
    db
      .select({
        spaceId: spaceCodeRequestsTable.spaceId,
        pendingCount: count(),
      })
      .from(spaceCodeRequestsTable)
      .where(
        and(
          inArray(spaceCodeRequestsTable.spaceId, operatorSpaceIds),
          eq(spaceCodeRequestsTable.status, "PENDING"),
        ),
      )
      .groupBy(spaceCodeRequestsTable.spaceId),
  ]);

  const spaceMap = new Map(spaces.map((space) => [space.id, space]));
  const result = pendingCounts
    .map((pending) => ({
      space: spaceMap.get(pending.spaceId),
      pendingCount: Number(pending.pendingCount),
    }))
    .filter(
      (item): item is { space: (typeof spaces)[number]; pendingCount: number } =>
        item.space !== undefined && item.pendingCount > 0,
    )
    .sort((a, b) => a.space.name.localeCompare(b.space.name, "ko"));

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
    if (p.role !== "OPERATOR") {
      participantCountMap.set(p.spaceId, (participantCountMap.get(p.spaceId) ?? 0) + 1);
    }
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
  const participationBySpaceAndUser = new Map(
    allParticipations.map((p) => [`${p.spaceId}:${p.userId}`, p]),
  );

  const result = spaces.map((space) => ({
    ...space,
    myRole: roleMap.get(space.id) ?? "PARTICIPANT",
    participantCount: participantCountMap.get(space.id) ?? 0,
    activeRound: activeRoundMap.get(space.id) ?? null,
    operatorNickname: space.isAnonymous
      ? getAnonymousDisplayName(
          space,
          participationBySpaceAndUser.get(`${space.id}:${space.creatorId}`)?.spaceNickname,
        )
      : (creatorNicknameMap.get(space.creatorId) ?? null),
  }));

  res.json(result);
});

router.post("/spaces", requireAuth, async (req, res) => {
  const body =
    typeof req.body === "object" && req.body !== null && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
  const diagnostic = getSpaceCreationDiagnostic("space", req.headers, body);
  req.log.info({ spaceCreation: diagnostic }, "POST /spaces: creation requested");
  const callerId = req.user!.id;
  if (body.creatorId && body.creatorId !== callerId) {
    res.status(403).json({ error: "공간은 로그인한 사용자만 생성할 수 있습니다." });
    return;
  }
  const hasCreationKey = Object.prototype.hasOwnProperty.call(body, "creationKey");
  const creationKey = parseSpaceCreationKey(body.creationKey);
  if (hasCreationKey && !creationKey) {
    req.log.warn({ spaceCreation: diagnostic }, "POST /spaces: invalid creation key");
    res.status(400).json({ error: "공간 생성 요청을 다시 시도해주세요." });
    return;
  }
  const findCreationReplay = async () => {
    if (!creationKey) return null;
    const [existing] = await db
      .select()
      .from(spacesTable)
      .where(
        and(
          eq(spacesTable.creatorId, callerId),
          eq(spacesTable.creationKey, creationKey),
        ),
      )
      .limit(1);
    return existing ?? null;
  };
  const identity = parseSpaceCreationIdentity(body);
  if (!identity.success) {
    req.log.warn(
      { spaceCreation: diagnostic },
      "POST /spaces: identity validation failed",
    );
    res.status(400).json({ error: identity.error });
    return;
  }
  const { isAnonymous, anonymousNickname } = identity;
  const MAX_RETRIES = 5;
  let lastErr: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    const inviteCode: string = body.inviteCode ?? generateInviteCode();
    try {
      // Accept plannedStartsAt (new) or startsAt (legacy) for backward compat
      const {
        plannedStartsAt,
        startsAt,
        creatorId: _creatorId,
        creationKey: _creationKey,
        isAnonymous: _isAnonymous,
        spaceNickname: _spaceNickname,
        ...rest
      } = body;
      const resolvedPlannedStartsAt = plannedStartsAt ?? startsAt;
      const values = {
        ...rest,
        isAnonymous,
        creatorId: callerId,
        ...(creationKey ? { creationKey } : {}),
        inviteCode,
        ...(resolvedPlannedStartsAt != null ? { plannedStartsAt: toDate(resolvedPlannedStartsAt) } : {}),
      };
      const { space, replayed } = await createOrReuseSpace({
        findExisting: findCreationReplay,
        create: () => db.transaction(async (tx) => {
          const [createdSpace] = await tx.insert(spacesTable).values(values).returning();
          await tx.insert(spaceParticipationsTable).values({
            spaceId: createdSpace.id,
            userId: callerId,
            role: "OPERATOR",
            status: "APPROVED",
            ...(anonymousNickname ? { spaceNickname: anonymousNickname } : {}),
          });
          return createdSpace;
        }),
      });
      req.log.info(
        { spaceCreation: diagnostic },
        replayed
          ? "POST /spaces: creation retry recovered"
          : "POST /spaces: creation succeeded",
      );
      res.status(201).json(space);
      return;
    } catch (err: unknown) {
      const pg = getPgError(err);
      if (isSpaceNicknameConflict(err)) {
        req.log.warn(
          { spaceCreation: diagnostic },
          "POST /spaces: nickname conflict",
        );
        res.status(409).json({ error: "이미 사용 중인 공간 닉네임입니다." });
        return;
      }
      if (pg.code === "23505" && !body.inviteCode) {
        lastErr = err;
        continue;
      }
      req.log.error(
        { spaceCreation: diagnostic },
        "POST /spaces: creation failed",
      );
      res.status(500).json({ error: "공간 생성에 실패했습니다." });
      return;
    }
  }
  req.log.error(
    { spaceCreation: diagnostic },
    "POST /spaces: invite code collision after max retries",
  );
  res.status(500).json({ error: "공간 생성에 실패했습니다." });
});

router.post("/spaces/creation-replays", requireAuth, async (req, res) => {
  const creationKey = parseSpaceCreationKey(req.body?.creationKey);
  if (!creationKey) {
    res.status(400).json({ error: "공간 생성 요청을 다시 시도해주세요." });
    return;
  }

  const [space] = await db
    .select()
    .from(spacesTable)
    .where(
      and(
        eq(spacesTable.creatorId, req.user!.id),
        eq(spacesTable.creationKey, creationKey),
      ),
    )
    .limit(1);
  if (!space) {
    res.status(404).json({ error: "생성 중인 공간을 찾을 수 없습니다." });
    return;
  }
  res.json(space);
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
  const { displayNames } = await getSpaceDisplayNameMap(space.id, [space.creatorId]);
  const [{ value: participantCount }] = await db
    .select({ value: count() })
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, space.id),
        eq(spaceParticipationsTable.status, "APPROVED"),
        ne(spaceParticipationsTable.role, "OPERATOR"),
      ),
    );
  res.json({ ...space, creatorNickname: displayNames.get(space.creatorId) ?? null, participantCount });
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

// ─── Recruiting basic settings (operator only) ────────────────────────────────
//
// This is intentionally separate from PATCH /spaces/:id. The latter is used by
// the existing inline description editor, while this endpoint protects the
// creation-time settings with a recruiting-state gate.
router.get("/spaces/:id/basic-settings", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const spaceId = String(req.params.id);
  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, spaceId))
    .limit(1);
  if (!space) {
    res.status(404).json({ error: "공간을 찾을 수 없어요.", code: "SPACE_NOT_FOUND" });
    return;
  }

  const [participation] = await db
    .select()
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, space.id),
        eq(spaceParticipationsTable.userId, callerId),
        eq(spaceParticipationsTable.role, "OPERATOR"),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    )
    .limit(1);
  const accessIssue = getSpaceBasicSettingsAccessIssue(space.status, participation);
  if (accessIssue === "FORBIDDEN") {
    res.status(403).json({
      error: "공간장만 기본 설정을 확인할 수 있어요.",
      code: "SPACE_BASIC_SETTINGS_FORBIDDEN",
    });
    return;
  }
  if (accessIssue === "NOT_RECRUITING") {
    res.status(409).json({
      error: "모집 중인 공간에서만 기본 설정을 확인할 수 있어요.",
      code: "SPACE_BASIC_SETTINGS_NOT_RECRUITING",
    });
    return;
  }

  res.json(toSpaceBasicSettingsResponse(space));
});

router.patch("/spaces/:id/basic-settings", requireAuth, async (req, res) => {
  const parsed = parseSpaceBasicSettingsInput(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error });
    return;
  }

  const callerId = req.user!.id;
  const spaceId = String(req.params.id);
  const { name, description, isAnonymous } = parsed.data;

  type UpdateResult =
    | { kind: "updated"; settings: ReturnType<typeof toSpaceBasicSettingsResponse> }
    | { kind: "not_found" }
    | { kind: "forbidden" }
    | { kind: "not_recruiting" }
    | { kind: "incomplete_anonymous_conversion" };

  try {
    const result: UpdateResult = await db.transaction(async (tx) => {
      // Serializes this edit with start-space and nickname-reservation updates.
      const space = await getLockedSpaceForNicknameMutation(tx, spaceId);
      if (!space) return { kind: "not_found" };

      const [operatorParticipation] = await tx
        .select()
        .from(spaceParticipationsTable)
        .where(
          and(
            eq(spaceParticipationsTable.spaceId, space.id),
            eq(spaceParticipationsTable.userId, callerId),
            eq(spaceParticipationsTable.role, "OPERATOR"),
            eq(spaceParticipationsTable.status, "APPROVED"),
          ),
        )
        .limit(1);
      const accessIssue = getSpaceBasicSettingsAccessIssue(space.status, operatorParticipation);
      if (accessIssue === "FORBIDDEN") return { kind: "forbidden" };
      if (accessIssue === "NOT_RECRUITING") return { kind: "not_recruiting" };

      if (!space.isAnonymous && isAnonymous) {
        if (!operatorParticipation.spaceNickname?.trim()) {
          return { kind: "incomplete_anonymous_conversion" };
        }
        const [[incompleteParticipation], [incompleteCodeRequest]] = await Promise.all([
          tx
            .select({ id: spaceParticipationsTable.id })
            .from(spaceParticipationsTable)
            .where(
              and(
                eq(spaceParticipationsTable.spaceId, space.id),
                inArray(spaceParticipationsTable.status, ["PENDING", "APPROVED"]),
                ne(spaceParticipationsTable.userId, callerId),
                sql`coalesce(btrim(${spaceParticipationsTable.spaceNickname}), '') = ''`,
              ),
            )
            .limit(1),
          tx
            .select({ id: spaceCodeRequestsTable.id })
            .from(spaceCodeRequestsTable)
            .where(
              and(
                eq(spaceCodeRequestsTable.spaceId, space.id),
                inArray(spaceCodeRequestsTable.status, ["PENDING", "APPROVED"]),
                ne(spaceCodeRequestsTable.requesterId, callerId),
                sql`coalesce(btrim(${spaceCodeRequestsTable.spaceNickname}), '') = ''`,
              ),
            )
            .limit(1),
        ]);
        if (
          shouldBlockAnonymousConversion(
            space.isAnonymous,
            isAnonymous,
            !!incompleteParticipation,
            !!incompleteCodeRequest,
          )
        ) {
          return { kind: "incomplete_anonymous_conversion" };
        }
      }

      const [updatedSpace] = await tx
        .update(spacesTable)
        .set({
          name,
          description,
          isAnonymous,
        })
        .where(eq(spacesTable.id, space.id))
        .returning();
      return {
        kind: "updated",
        settings: toSpaceBasicSettingsResponse(updatedSpace),
      };
    });

    if (result.kind === "not_found") {
      res.status(404).json({ error: "공간을 찾을 수 없어요.", code: "SPACE_NOT_FOUND" });
      return;
    }
    if (result.kind === "forbidden") {
      res.status(403).json({
        error: "공간장만 기본 설정을 바꿀 수 있어요.",
        code: "SPACE_BASIC_SETTINGS_FORBIDDEN",
      });
      return;
    }
    if (result.kind === "not_recruiting") {
      res.status(409).json({
        error: "모집 중인 공간에서만 기본 설정을 바꿀 수 있어요.",
        code: "SPACE_BASIC_SETTINGS_NOT_RECRUITING",
      });
      return;
    }
    if (result.kind === "incomplete_anonymous_conversion") {
      res.status(409).json({
        error: "운영자 또는 기존 참여자·신청자 중 공간 닉네임이 없는 사람이 있어 익명 공간으로 전환할 수 없어요.",
        code: "SPACE_BASIC_SETTINGS_ANONYMOUS_IDENTITY_INCOMPLETE",
      });
      return;
    }
    res.json(result.settings);
  } catch (err) {
    if (isSpaceNicknameConflict(err)) {
      res.status(409).json({
        error: "이미 사용 중인 공간 닉네임입니다.",
        code: "SPACE_BASIC_SETTINGS_NICKNAME_CONFLICT",
      });
      return;
    }
    console.error("PATCH /spaces/:id/basic-settings error:", err);
    res.status(500).json({ error: "기본 설정 저장에 실패했어요." });
  }
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
  plannedStartsAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  scheduleType: z.enum(["N_DAY", "WEEKDAY"]),
  interval: z.number().int().min(1).optional(),
  weekdays: z.array(z.number().int().min(0).max(6)).optional(),
  defaultCenterCount: z.number().int().min(1).optional(),
  rounds: z.array(startSpaceRoundSchema).optional(),
  operatorParticipates: z.boolean().default(true),
});

class InvalidOpeningScheduleError extends Error {}

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
  const now = new Date();
  const scheduleStartsAt = new Date(`${body.plannedStartsAt}T00:00:00.000Z`);
  const isValidPlannedStart =
    !Number.isNaN(scheduleStartsAt.getTime()) &&
    scheduleStartsAt.toISOString().slice(0, 10) === body.plannedStartsAt;
  if (!isValidPlannedStart) {
    res.status(400).json({ error: "올바른 시작 예정일을 선택해주세요." });
    return;
  }
  if (body.plannedStartsAt < kstDateString(now)) {
    res.status(400).json({ error: "시작 예정일은 오늘 이후로 선택해주세요." });
    return;
  }
  const openingDeadline = new Date(scheduleStartsAt);
  openingDeadline.setUTCDate(openingDeadline.getUTCDate() - 1);
  const openingDeadlineKey = openingDeadline.toISOString().slice(0, 10);
  const minOpeningSendKey = kstDateString(computeDeliverySlot(now));

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
  const intervalDays = body.interval ?? space.defaultCenterInterval;
  const centerCount = body.defaultCenterCount ?? space.defaultCenterCount;
  const weekdays = body.weekdays ?? [];
  let rejectedRequesterIds: string[] = [];

  let alreadyStarted = false;
  try {
    await db.transaction(async (tx) => {
      // Prevent indefinite blocking when the background scheduler holds row
      // locks on space_scheduled_sends (which cascades through space_rounds /
      // space_round_slots). 8 s is generous enough for the scheduler's own
      // short transactions to complete, while still surfacing a real lock
      // contention as a fast error rather than a multi-minute hang.
      await tx.execute(sql`SET LOCAL lock_timeout = '8000ms'`);

      // Conditionally flip RECRUITING -> ACTIVE. This is atomic at the row
      // level, so if two start requests race (e.g. a double-tap), only one
      // UPDATE affects a row; the other affects zero rows and we bail out
      // instead of proceeding to create duplicate rounds/slots.
      const updatedRows = await tx
        .update(spacesTable)
        .set({
          status: "ACTIVE",
          startedAt: now,
          plannedStartsAt: scheduleStartsAt,
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

      // Lock pending opening reservations in the same transaction as the
      // RECRUITING -> ACTIVE transition. A cancellation, reschedule, or
      // scheduler update therefore cannot invalidate the reservation between
      // this final check and the space activation commit.
      const pendingOpeningSends = await tx
        .select({ scheduledAt: spaceScheduledSendsTable.scheduledAt })
        .from(spaceScheduledSendsTable)
        .innerJoin(
          spaceLettersTable,
          eq(spaceScheduledSendsTable.spaceLetterId, spaceLettersTable.id),
        )
        .where(
          and(
            eq(spaceScheduledSendsTable.spaceId, req.params.id),
            eq(spaceScheduledSendsTable.status, "PENDING"),
            eq(spaceLettersTable.letterType, "OPENING"),
          ),
        )
        .for("update");
      const hasValidOpeningSend = pendingOpeningSends.some((send) => {
        const dateKey = kstDateString(send.scheduledAt);
        return dateKey >= minOpeningSendKey && dateKey <= openingDeadlineKey;
      });
      if (!hasValidOpeningSend) {
        throw new InvalidOpeningScheduleError();
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

      // Create rounds and slots. `slotCursor` tracks the global center-article
      // position across all rounds. Multiple slots share one schedule occasion
      // according to centerCount, including across round boundaries.
      let firstRoundId: string | null = null;
      let slotCursor = 0;
      for (let i = 0; i < body.roundCount; i++) {
        const roundConfig = effectiveRounds[i] as Exclude<typeof effectiveRounds[number], { error: string }>;
        const slots = roundConfig?.slots ?? [];

        const roundStartDate = calculateOccasionDate(
          scheduleStartsAt,
          body.scheduleType,
          intervalDays,
          weekdays,
          calculateSlotOccasionIndex(slotCursor, centerCount),
        );
        const roundEndDate =
          slots.length > 0
            ? calculateOccasionDate(
                scheduleStartsAt,
                body.scheduleType,
                intervalDays,
                weekdays,
                calculateSlotOccasionIndex(
                  slotCursor + slots.length - 1,
                  centerCount,
                ),
              )
            : roundStartDate;

        const [round] = await tx
          .insert(spaceRoundsTable)
          .values({
            spaceId: req.params.id,
            roundNumber: i + 1,
            title: roundConfig?.title ?? null,
            description: roundConfig?.description ?? null,
            ...(roundStartDate ? { startsAt: roundStartDate } : {}),
            ...(roundEndDate ? { endsAt: roundEndDate } : {}),
          })
          .returning();
        if (i === 0) firstRoundId = round.id;

        // Create slots for this round (already filtered for operator if
        // needed), each pinned to its own occasion date so the detail
        // screen's "내 차례" state and the reservation screen's assignment
        // check always agree (both key off `scheduledDate` being present).
        for (let j = 0; j < slots.length; j++) {
          const slotDate = calculateOccasionDate(
            scheduleStartsAt,
            body.scheduleType,
            intervalDays,
            weekdays,
            calculateSlotOccasionIndex(slotCursor + j, centerCount),
          );
          await tx.insert(spaceRoundSlotsTable).values({
            spaceRoundId: round.id,
            assignedUserId: slots[j],
            slotOrder: j,
            ...(slotDate ? { scheduledDate: kstDateString(slotDate) } : {}),
          });
        }
        slotCursor += slots.length;
      }

      // Link every round-less OPENING letter to round 1. Multiple opening
      // letters may be reserved for the same round, so none of the drafts or
      // their scheduled sends should be abandoned when the space starts.
      if (firstRoundId) {
        const roundlessOpeningLetters = await tx
          .select({ id: spaceLettersTable.id })
          .from(spaceLettersTable)
          .where(
            and(
              eq(spaceLettersTable.spaceId, req.params.id),
              eq(spaceLettersTable.letterType, "OPENING"),
              isNull(spaceLettersTable.spaceRoundId),
            ),
          );
        if (roundlessOpeningLetters.length > 0) {
          await tx
            .update(spaceLettersTable)
            .set({ spaceRoundId: firstRoundId })
            .where(inArray(spaceLettersTable.id, roundlessOpeningLetters.map((letter) => letter.id)));
        }
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
    if (err instanceof InvalidOpeningScheduleError) {
      res.status(400).json({
        error: "여는 편지는 시작 예정일 전날 오전 6시까지 예약해야 해요. 시작 예정일을 늦추거나 발신일을 다시 선택해주세요.",
      });
      return;
    }
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
  // Keep read paths in sync even if the periodic scheduler was briefly down.
  const spaceId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
  await synchronizeSpaceRoundStatuses(new Date(), spaceId);
  const rounds = await db
    .select()
    .from(spaceRoundsTable)
    .where(eq(spaceRoundsTable.spaceId, req.params.id));
  res.json(rounds);
});

router.post("/spaces/:id/rounds", requireAuth, async (req, res) => {
  const body =
    typeof req.body === "object" && req.body !== null && !Array.isArray(req.body)
      ? req.body as Record<string, unknown>
      : {};
  const diagnostic = getSpaceCreationDiagnostic("round", req.headers, body);
  req.log.info({ spaceCreation: diagnostic }, "POST /spaces/:id/rounds: creation requested");
  try {
    const [callerParticipation] = await db
      .select()
      .from(spaceParticipationsTable)
      .where(
        and(
          eq(spaceParticipationsTable.spaceId, req.params.id),
          eq(spaceParticipationsTable.userId, req.user!.id),
        ),
      )
      .limit(1);
    if (!canCreateSpaceRound(callerParticipation)) {
      req.log.warn(
        { spaceCreation: diagnostic },
        "POST /spaces/:id/rounds: creator is not an approved operator",
      );
      res.status(403).json({ error: "공간 운영자만 회차를 만들 수 있습니다." });
      return;
    }

    const { startsAt, endsAt, ...rest } = body;
    if (!Number.isInteger(rest.roundNumber) || (rest.roundNumber as number) < 1) {
      res.status(400).json({ error: "회차 번호를 올바르게 입력해주세요." });
      return;
    }
    const values = {
      ...rest,
      spaceId: req.params.id,
      ...(startsAt != null ? { startsAt: toDate(startsAt) } : {}),
      ...(endsAt != null ? { endsAt: toDate(endsAt) } : {}),
    };
    const { round, replayed } = await createOrReuseSpaceRound({
      insert: async () => {
        const [created] = await db
          .insert(spaceRoundsTable)
          .values(values)
          .onConflictDoNothing({
            target: [spaceRoundsTable.spaceId, spaceRoundsTable.roundNumber],
          })
          .returning();
        return created;
      },
      findExisting: async () => {
        const [existing] = await db
          .select()
          .from(spaceRoundsTable)
          .where(
            and(
              eq(spaceRoundsTable.spaceId, req.params.id),
              eq(spaceRoundsTable.roundNumber, rest.roundNumber as number),
            ),
          )
          .limit(1);
        return existing;
      },
    });
    req.log.info(
      { spaceCreation: diagnostic },
      replayed
        ? "POST /spaces/:id/rounds: creation retry recovered"
        : "POST /spaces/:id/rounds: creation succeeded",
    );
    res.status(201).json(round);
  } catch (err: unknown) {
    req.log.error(
      { spaceCreation: diagnostic },
      "POST /spaces/:id/rounds: creation failed",
    );
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
  const roundIds = [...new Set(slots.map((slot) => slot.spaceRoundId))];
  const rounds = await db
    .select({ id: spaceRoundsTable.id, spaceId: spaceRoundsTable.spaceId })
    .from(spaceRoundsTable)
    .where(inArray(spaceRoundsTable.id, roundIds));
  const spaceByRoundId = new Map(rounds.map((round) => [round.id, round.spaceId]));
  const userIdsBySpaceId = new Map<string, string[]>();
  for (const slot of slots) {
    const spaceId = spaceByRoundId.get(slot.spaceRoundId);
    if (!spaceId) continue;
    userIdsBySpaceId.set(spaceId, [...(userIdsBySpaceId.get(spaceId) ?? []), slot.assignedUserId]);
  }
  const displayNamesBySpaceId = new Map<string, Map<string, string>>();
  await Promise.all([...userIdsBySpaceId.entries()].map(async ([spaceId, userIds]) => {
    const { displayNames } = await getSpaceDisplayNameMap(spaceId, userIds);
    displayNamesBySpaceId.set(spaceId, displayNames);
  }));
  return slots.map((slot) => ({
    ...slot,
    assignedUserNickname: displayNamesBySpaceId
      .get(spaceByRoundId.get(slot.spaceRoundId) ?? "")
      ?.get(slot.assignedUserId) ?? null,
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

// ─── Space Members (with state-safe display names, for slot assignment) ───────

router.get("/spaces/:id/members", requireAuth, async (req, res) => {
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
    res.status(403).json({ error: "Only operators can view the member list" });
    return;
  }

  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id))
    .limit(1);
  const displayContext = req.query.displayContext === "PARTICIPANT_MANAGEMENT"
    ? "PARTICIPANT_MANAGEMENT"
    : req.query.displayContext === "START_ORDER"
      ? "START_ORDER"
      : "SAFE";
  const participations = await db
    .select({
      id: spaceParticipationsTable.id,
      userId: spaceParticipationsTable.userId,
      role: spaceParticipationsTable.role,
      status: spaceParticipationsTable.status,
      spaceNickname: spaceParticipationsTable.spaceNickname,
      nickname: usersTable.nickname,
      createdAt: spaceParticipationsTable.createdAt,
    })
    .from(spaceParticipationsTable)
    .innerJoin(usersTable, eq(spaceParticipationsTable.userId, usersTable.id))
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, req.params.id),
        eq(spaceParticipationsTable.status, "APPROVED"),
      ),
    )
    .orderBy(spaceParticipationsTable.createdAt);

  const result = participations.map((p) => ({
    ...p,
    // The member endpoint is operator-only. Raw identity is returned only for
    // the explicitly requested screen context; every other context stays safe.
    nickname: space?.isAnonymous && displayContext !== "PARTICIPANT_MANAGEMENT"
      ? getAnonymousDisplayName(space, p.spaceNickname)
      : p.nickname,
    spaceNickname: space?.isAnonymous
      ? displayContext === "START_ORDER" ? p.spaceNickname : getAnonymousDisplayName(space, p.spaceNickname)
      : null,
    displayName: space?.isAnonymous
      ? displayContext === "START_ORDER" ? p.spaceNickname : getAnonymousDisplayName(space, p.spaceNickname)
      : null,
    accountNickname: displayContext === "PARTICIPANT_MANAGEMENT" ? p.nickname : null,
  }));
  res.json(result);
});

router.get("/spaces/:id/participations", async (req, res) => {
  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id))
    .limit(1);
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  const participations = await db
    .select()
    .from(spaceParticipationsTable)
    .where(eq(spaceParticipationsTable.spaceId, req.params.id));
  const { displayNames } = await getSpaceDisplayNameMap(
    space.id,
    participations.map((participation) => participation.userId),
  );
  res.json(participations.map((participation) =>
    sanitizeParticipationDisplay(
      participation,
      space.isAnonymous ? displayNames.get(participation.userId) : undefined,
    ),
  ));
});

router.post("/spaces/:id/participations", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  if (req.body.userId && req.body.userId !== callerId) {
    res.status(403).json({ error: "본인만 공간에 참여할 수 있습니다." });
    return;
  }
  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id))
    .limit(1);
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  const requestedSpaceNickname = parseAnonymousSpaceNickname(req.body.spaceNickname);
  try {
    const result = await db.transaction(async (tx) => {
      const currentSpace = await getLockedSpaceForNicknameMutation(tx, space.id);
      if (!currentSpace) return "SPACE_NOT_FOUND" as const;
      const spaceNickname = currentSpace.isAnonymous ? requestedSpaceNickname : null;
      if (currentSpace.isAnonymous && !spaceNickname) {
        return "MISSING_NICKNAME" as const;
      }
      if (spaceNickname && await hasReservedSpaceNickname(tx, space.id, spaceNickname)) {
        return "NICKNAME_CONFLICT" as const;
      }
      const [created] = await tx
        .insert(spaceParticipationsTable)
        .values({
          spaceId: space.id,
          userId: callerId,
          role: "PARTICIPANT",
          status: "PENDING",
          ...(spaceNickname ? { spaceNickname } : {}),
        })
        .returning();
      return { participation: created, space: currentSpace };
    });
    if (result === "SPACE_NOT_FOUND") {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    if (result === "MISSING_NICKNAME") {
      res.status(400).json({ error: "익명 공간에 참여하려면 공간 닉네임이 필요합니다." });
      return;
    }
    if (result === "NICKNAME_CONFLICT") {
      res.status(409).json({ error: "이미 사용 중인 공간 닉네임입니다." });
      return;
    }
    res.status(201).json(sanitizeParticipationDisplay(
      result.participation,
      result.space.isAnonymous
        ? getAnonymousDisplayName(result.space, result.participation.spaceNickname)
        : undefined,
    ));
  } catch (err) {
    if (isSpaceNicknameConflict(err)) {
      res.status(409).json({ error: "이미 사용 중인 공간 닉네임입니다." });
      return;
    }
    throw err;
  }
});

router.patch("/spaces/:id/participations/:participationId", requireAuth, async (req, res) => {
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
    res.status(403).json({ error: "Only operators can update participations" });
    return;
  }
  if (req.body.spaceNickname !== undefined) {
    res.status(400).json({ error: "공간 입장 후에는 닉네임을 변경할 수 없습니다." });
    return;
  }
  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id))
    .limit(1);
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  const participation = await db.transaction(async (tx) => {
    const currentSpace = await getLockedSpaceForNicknameMutation(tx, space.id);
    if (!currentSpace) return null;
    const [target] = await tx
      .select()
      .from(spaceParticipationsTable)
      .where(
        and(
          eq(spaceParticipationsTable.id, req.params.participationId),
          eq(spaceParticipationsTable.spaceId, req.params.id),
        ),
      )
      .limit(1);
    if (!target) return null;
    const nextStatus = req.body.status ?? target.status;
    const nextRole = req.body.role ?? target.role;
    if (
      !["PENDING", "APPROVED", "REJECTED", "WITHDRAWN"].includes(nextStatus)
    ) {
      return "INVALID_STATUS" as const;
    }
    if (
      startsConsumingRecruitmentPlace(
        { status: target.status, role: target.role },
        { status: nextStatus, role: nextRole },
      ) &&
      isRecruitmentFull(
        currentSpace.maxParticipants,
        await getApprovedRecruitParticipantCount(tx, currentSpace.id),
      )
    ) {
      return "SPACE_FULL" as const;
    }
    if (
      currentSpace.isAnonymous &&
      ["PENDING", "APPROVED"].includes(nextStatus) &&
      !target.spaceNickname
    ) {
      return "MISSING_NICKNAME" as const;
    }
    if (
      currentSpace.isAnonymous &&
      ["PENDING", "APPROVED"].includes(nextStatus) &&
      target.spaceNickname &&
      await hasReservedSpaceNickname(tx, space.id, target.spaceNickname, {
        exceptParticipationId: target.id,
      })
    ) {
      return "NICKNAME_CONFLICT" as const;
    }
    const [updated] = await tx
      .update(spaceParticipationsTable)
      .set({ status: req.body.status, role: req.body.role })
      .where(eq(spaceParticipationsTable.id, target.id))
      .returning();
    return { participation: updated, space: currentSpace };
  });
  if (!participation) {
    res.status(404).json({ error: "Participation not found" });
    return;
  }
  if (participation === "MISSING_NICKNAME") {
    res.status(400).json({ error: "익명 공간에 참여하려면 공간 닉네임이 필요합니다." });
    return;
  }
  if (participation === "INVALID_STATUS") {
    res.status(400).json({ error: "잘못된 참여 상태입니다." });
    return;
  }
  if (participation === "SPACE_FULL") {
    res.status(409).json({ error: "모집 인원이 모두 찼습니다." });
    return;
  }
  if (participation === "NICKNAME_CONFLICT") {
    res.status(409).json({ error: "이미 사용 중인 공간 닉네임입니다." });
    return;
  }
  res.json(sanitizeParticipationDisplay(
    participation.participation,
    participation.space.isAnonymous
      ? getAnonymousDisplayName(participation.space, participation.participation.spaceNickname)
      : undefined,
  ));
});

router.get("/spaces/:id/invitations", async (req, res) => {
  const invitations = await db
    .select()
    .from(spaceInvitationsTable)
    .where(eq(spaceInvitationsTable.spaceId, req.params.id));
  res.json(invitations);
});

router.post("/spaces/:id/invitations", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  if (req.body.invitedBy && req.body.invitedBy !== callerId) {
    res.status(403).json({ error: "본인만 초대를 보낼 수 있습니다." });
    return;
  }
  const [invitation] = await db
    .insert(spaceInvitationsTable)
    .values({ ...req.body, spaceId: req.params.id, invitedBy: callerId })
    .returning();
  res.status(201).json(invitation);
});

router.patch("/spaces/:id/invitations/:invitationId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const { status } = req.body;
  if (!["ACCEPTED", "DECLINED"].includes(status)) {
    res.status(400).json({ error: "잘못된 초대 상태입니다." });
    return;
  }
  const [existingInvitation] = await db
    .select()
    .from(spaceInvitationsTable)
    .where(
      and(
        eq(spaceInvitationsTable.id, req.params.invitationId),
        eq(spaceInvitationsTable.spaceId, req.params.id),
      ),
    )
    .limit(1);
  if (!existingInvitation) {
    res.status(404).json({ error: "Invitation not found" });
    return;
  }
  if (existingInvitation.invitedUserId !== callerId) {
    res.status(403).json({ error: "초대받은 사용자만 응답할 수 있습니다." });
    return;
  }
  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id))
    .limit(1);
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  const requestedSpaceNickname = status === "ACCEPTED"
    ? parseAnonymousSpaceNickname(req.body.spaceNickname)
    : null;
  try {
    const result = await db.transaction(async (tx) => {
      const currentSpace = await getLockedSpaceForNicknameMutation(tx, space.id);
      if (!currentSpace) return null;
      const [invitation] = await tx
        .select()
        .from(spaceInvitationsTable)
        .where(eq(spaceInvitationsTable.id, existingInvitation.id))
        .limit(1);
      if (!invitation) return null;
      if (invitation.status !== "PENDING") {
        return "ALREADY_RESPONDED" as const;
      }
      const spaceNickname = status === "ACCEPTED" && currentSpace.isAnonymous
        ? requestedSpaceNickname
        : null;
      if (status === "ACCEPTED" && currentSpace.isAnonymous && !spaceNickname) {
        return "MISSING_NICKNAME" as const;
      }
      const [existingParticipation] = await tx
        .select({ id: spaceParticipationsTable.id })
        .from(spaceParticipationsTable)
        .where(
          and(
            eq(spaceParticipationsTable.spaceId, space.id),
            eq(spaceParticipationsTable.userId, callerId),
          ),
        )
        .limit(1);
      if (existingParticipation) {
        return "ALREADY_PARTICIPATING" as const;
      }
      if (status === "ACCEPTED" && currentSpace.status !== "RECRUITING") {
        return "SPACE_NOT_RECRUITING" as const;
      }
      if (
        status === "ACCEPTED" &&
        isRecruitmentFull(
          currentSpace.maxParticipants,
          await getApprovedRecruitParticipantCount(tx, currentSpace.id),
        )
      ) {
        return "SPACE_FULL" as const;
      }
      if (spaceNickname && await hasReservedSpaceNickname(tx, space.id, spaceNickname)) {
        return "NICKNAME_CONFLICT" as const;
      }
      const [updatedInvitation] = await tx
        .update(spaceInvitationsTable)
        .set({ status })
        .where(eq(spaceInvitationsTable.id, invitation.id))
        .returning();
      if (status === "ACCEPTED") {
        await tx.insert(spaceParticipationsTable).values({
          spaceId: space.id,
          userId: callerId,
          role: "PARTICIPANT",
          status: "APPROVED",
          joinPath: "INVITATION",
          invitationId: invitation.id,
          ...(spaceNickname ? { spaceNickname } : {}),
        });
      }
      return updatedInvitation;
    });
    if (!result) {
      res.status(404).json({ error: "Invitation not found" });
      return;
    }
    if (result === "NICKNAME_CONFLICT") {
      sendSpaceJoinError(res, 409, result, "이미 사용 중인 공간 닉네임입니다.");
      return;
    }
    if (result === "MISSING_NICKNAME") {
      sendSpaceJoinError(res, 400, result, "익명 공간에 참여하려면 공간 닉네임이 필요합니다.");
      return;
    }
    if (result === "ALREADY_RESPONDED") {
      sendSpaceJoinError(res, 409, result, "이미 응답한 초대입니다.");
      return;
    }
    if (result === "ALREADY_PARTICIPATING") {
      sendSpaceJoinError(res, 409, result, "이미 이 공간에 참여한 사용자입니다.");
      return;
    }
    if (result === "SPACE_FULL") {
      sendSpaceJoinError(res, 409, result, "모집 인원이 모두 찼습니다.");
      return;
    }
    if (result === "SPACE_NOT_RECRUITING") {
      sendSpaceJoinError(res, 409, result, "모집이 마감된 공간입니다.");
      return;
    }
    res.json(result);
  } catch (err) {
    if (isSpaceNicknameConflict(err)) {
      sendSpaceJoinError(res, 409, "NICKNAME_CONFLICT", "이미 사용 중인 공간 닉네임입니다.");
      return;
    }
    throw err;
  }
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
  const { displayNames } = await getSpaceDisplayNameMap(
    req.params.id,
    codeRequests.map((request) => request.requesterId),
  );
  const result = codeRequests.map((r) => ({
    codeRequest: { ...r, spaceNickname: displayNames.get(r.requesterId) ?? null },
    requesterNickname: displayNames.get(r.requesterId) ?? null,
  }));
  res.json(result);
});

router.post("/spaces/:id/code-requests", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  if (req.body.requesterId && req.body.requesterId !== callerId) {
    res.status(403).json({ error: "본인만 참여를 신청할 수 있습니다." });
    return;
  }
  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id))
    .limit(1);
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  const requestedSpaceNickname = parseAnonymousSpaceNickname(req.body.spaceNickname);
  try {
    const request = await db.transaction(async (tx) => {
      const currentSpace = await getLockedSpaceForNicknameMutation(tx, space.id);
      if (!currentSpace) return "SPACE_NOT_FOUND" as const;
      const submittedCode = typeof req.body.code === "string" ? req.body.code.trim() : "";
      if (!currentSpace.inviteCode || submittedCode !== currentSpace.inviteCode) {
        return "INVITE_CODE_MISMATCH" as const;
      }
      const spaceNickname = currentSpace.isAnonymous ? requestedSpaceNickname : null;
      const [existingRequest] = await tx
        .select({ id: spaceCodeRequestsTable.id })
        .from(spaceCodeRequestsTable)
        .where(
          and(
            eq(spaceCodeRequestsTable.spaceId, space.id),
            eq(spaceCodeRequestsTable.requesterId, callerId),
            eq(spaceCodeRequestsTable.status, "PENDING"),
          ),
        )
        .limit(1);
      if (existingRequest) {
        return "DUPLICATE_CODE_REQUEST" as const;
      }
      if (currentSpace.isAnonymous && !spaceNickname) {
        return "MISSING_NICKNAME" as const;
      }
      const [existingParticipation] = await tx
        .select({ id: spaceParticipationsTable.id })
        .from(spaceParticipationsTable)
        .where(
          and(
            eq(spaceParticipationsTable.spaceId, space.id),
            eq(spaceParticipationsTable.userId, callerId),
          ),
        )
        .limit(1);
      if (existingParticipation) {
        return "ALREADY_PARTICIPATING" as const;
      }
      if (currentSpace.status !== "RECRUITING") {
        return "SPACE_NOT_RECRUITING" as const;
      }
      if (
        isRecruitmentFull(
          currentSpace.maxParticipants,
          await getApprovedRecruitParticipantCount(tx, currentSpace.id),
        )
      ) {
        return "SPACE_FULL" as const;
      }
      if (spaceNickname && await hasReservedSpaceNickname(tx, space.id, spaceNickname)) {
        return "NICKNAME_CONFLICT" as const;
      }
      const [created] = await tx
        .insert(spaceCodeRequestsTable)
        .values({
          spaceId: space.id,
          requesterId: callerId,
          code: currentSpace.inviteCode,
          ...(spaceNickname ? { spaceNickname } : {}),
        })
        .returning();
      return { request: created, space: currentSpace };
    });
    if (request === "SPACE_NOT_FOUND") {
      res.status(404).json({ error: "Space not found" });
      return;
    }
    if (request === "INVITE_CODE_MISMATCH") {
      sendSpaceJoinError(res, 400, request, "초대 문구가 이 공간과 일치하지 않습니다.");
      return;
    }
    if (request === "DUPLICATE_CODE_REQUEST") {
      sendSpaceJoinError(res, 409, request, "이미 이 공간에 참여 신청을 보냈습니다.");
      return;
    }
    if (request === "MISSING_NICKNAME") {
      sendSpaceJoinError(res, 400, request, "익명 공간에 참여하려면 공간 닉네임이 필요합니다.");
      return;
    }
    if (request === "NICKNAME_CONFLICT") {
      sendSpaceJoinError(res, 409, request, "이미 사용 중인 공간 닉네임입니다.");
      return;
    }
    if (request === "ALREADY_PARTICIPATING") {
      sendSpaceJoinError(res, 409, request, "이미 이 공간에 참여한 사용자입니다.");
      return;
    }
    if (request === "SPACE_FULL") {
      sendSpaceJoinError(res, 409, request, "모집 인원이 모두 찼습니다.");
      return;
    }
    if (request === "SPACE_NOT_RECRUITING") {
      sendSpaceJoinError(res, 409, request, "모집이 마감된 공간입니다.");
      return;
    }
    res.status(201).json({
      ...request.request,
      spaceNickname: request.space.isAnonymous
        ? getAnonymousDisplayName(request.space, request.request.spaceNickname)
        : null,
    });
  } catch (err) {
    if (isSpaceNicknameConflict(err)) {
      sendSpaceJoinError(res, 409, "NICKNAME_CONFLICT", "이미 사용 중인 공간 닉네임입니다.");
      return;
    }
    throw err;
  }
});

router.patch("/spaces/:id/code-requests/:requestId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const { status, rejectionReason } = req.body;
  if (!["APPROVED", "REJECTED", "CANCELLED"].includes(status)) {
    res.status(400).json({ error: "잘못된 신청 상태입니다." });
    return;
  }
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
  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id))
    .limit(1);
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  try {
    const result = await db.transaction(async (tx) => {
      const currentSpace = await getLockedSpaceForNicknameMutation(tx, space.id);
      if (!currentSpace) return null;
      const [codeRequest] = await tx
        .select()
        .from(spaceCodeRequestsTable)
        .where(
          and(
            eq(spaceCodeRequestsTable.id, req.params.requestId),
            eq(spaceCodeRequestsTable.spaceId, req.params.id),
          ),
        )
        .limit(1);
      if (!codeRequest) return null;
      if (codeRequest.status !== "PENDING") {
        return "ALREADY_RESPONDED" as const;
      }
      const [existingParticipation] = await tx
        .select({ id: spaceParticipationsTable.id })
        .from(spaceParticipationsTable)
        .where(
          and(
            eq(spaceParticipationsTable.spaceId, space.id),
            eq(spaceParticipationsTable.userId, codeRequest.requesterId),
          ),
        )
        .limit(1);
      if (existingParticipation) {
        return "ALREADY_PARTICIPATING" as const;
      }
      if (status === "APPROVED" && currentSpace.status !== "RECRUITING") {
        return "SPACE_NOT_RECRUITING" as const;
      }
      if (
        status === "APPROVED" &&
        isRecruitmentFull(
          currentSpace.maxParticipants,
          await getApprovedRecruitParticipantCount(tx, currentSpace.id),
        )
      ) {
        return "SPACE_FULL" as const;
      }
      if (status === "APPROVED" && currentSpace.isAnonymous && !codeRequest.spaceNickname) {
        return "MISSING_NICKNAME" as const;
      }
      if (
        status === "APPROVED" &&
        currentSpace.isAnonymous &&
        codeRequest.spaceNickname &&
        await hasReservedSpaceNickname(tx, space.id, codeRequest.spaceNickname, {
          exceptCodeRequestId: codeRequest.id,
        })
      ) {
        return "NICKNAME_CONFLICT" as const;
      }
      const updateFields: Record<string, unknown> = { status };
      if (rejectionReason !== undefined) updateFields.rejectionReason = rejectionReason;
      const [updated] = await tx
        .update(spaceCodeRequestsTable)
        .set(updateFields)
        .where(eq(spaceCodeRequestsTable.id, codeRequest.id))
        .returning();
      if (status === "APPROVED") {
        await tx.insert(spaceParticipationsTable).values({
          spaceId: space.id,
          userId: codeRequest.requesterId,
          role: "PARTICIPANT",
          status: "APPROVED",
          joinPath: "CODE",
          codeRequestId: codeRequest.id,
          ...(codeRequest.spaceNickname ? { spaceNickname: codeRequest.spaceNickname } : {}),
        });
      }
      return { request: updated, space: currentSpace };
    });
    if (!result) {
      res.status(404).json({ error: "Code request not found" });
      return;
    }
    if (result === "MISSING_NICKNAME") {
      sendSpaceJoinError(res, 400, result, "익명 공간에 참여하려면 공간 닉네임이 필요합니다.");
      return;
    }
    if (result === "NICKNAME_CONFLICT") {
      sendSpaceJoinError(res, 409, result, "이미 사용 중인 공간 닉네임입니다.");
      return;
    }
    if (result === "ALREADY_RESPONDED") {
      sendSpaceJoinError(res, 409, result, "이미 처리된 참여 신청입니다.");
      return;
    }
    if (result === "ALREADY_PARTICIPATING") {
      sendSpaceJoinError(res, 409, result, "이미 이 공간에 참여한 사용자입니다.");
      return;
    }
    if (result === "SPACE_FULL") {
      sendSpaceJoinError(res, 409, result, "모집 인원이 모두 찼습니다.");
      return;
    }
    if (result === "SPACE_NOT_RECRUITING") {
      sendSpaceJoinError(res, 409, result, "모집이 마감된 공간입니다.");
      return;
    }
    res.json({
      ...result.request,
      spaceNickname: result.space.isAnonymous
        ? getAnonymousDisplayName(result.space, result.request.spaceNickname)
        : null,
    });
  } catch (err) {
    if (isSpaceNicknameConflict(err)) {
      sendSpaceJoinError(res, 409, "NICKNAME_CONFLICT", "이미 사용 중인 공간 닉네임입니다.");
      return;
    }
    throw err;
  }
});

router.get("/spaces/:id/join-context", requireAuth, async (req, res) => {
  const userId = req.user!.id;
  const [space] = await db
    .select()
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id));
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  const { displayNames } = await getSpaceDisplayNameMap(space.id, [space.creatorId, userId]);
  const [{ value: participantCount }] = await db
    .select({ value: count() })
    .from(spaceParticipationsTable)
    .where(
      and(
        eq(spaceParticipationsTable.spaceId, space.id),
        eq(spaceParticipationsTable.status, "APPROVED"),
        ne(spaceParticipationsTable.role, "OPERATOR"),
      ),
    );
  const spaceWithInfo = {
    ...space,
    creatorNickname: displayNames.get(space.creatorId) ?? null,
    participantCount,
  };

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
    participation: participation
      ? sanitizeParticipationDisplay(
          participation,
          space.isAnonymous ? displayNames.get(participation.userId) : undefined,
        )
      : null,
    invitation: invitation ?? null,
    codeRequest: codeRequest
      ? { ...codeRequest, spaceNickname: displayNames.get(codeRequest.requesterId) ?? null }
      : null,
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

    // Visibility filter: RECIPIENT_ONLY letters authored by others are only visible
    // to users listed in letter_recipient_access for that letter.
    const recipientOnlyOtherLetterIds = letters
      .filter((l) => l.authorId !== callerId && l.visibility === "RECIPIENT_ONLY")
      .map((l) => l.id);
    if (recipientOnlyOtherLetterIds.length > 0) {
      const accessRows = await db
        .select({ letterId: letterRecipientAccessTable.letterId })
        .from(letterRecipientAccessTable)
        .where(
          and(
            inArray(letterRecipientAccessTable.letterId, recipientOnlyOtherLetterIds),
            eq(letterRecipientAccessTable.userId, callerId),
          ),
        );
      const accessibleLetterIds = new Set(accessRows.map((r) => r.letterId));
      letters = letters.filter(
        (l) =>
          l.authorId === callerId ||
          l.visibility !== "RECIPIENT_ONLY" ||
          accessibleLetterIds.has(l.id),
      );
    }
  }
  const articleIds = [...new Set(letters.map((l) => l.sourceArticleId).filter(Boolean) as string[])];
  const authorIds = [...new Set(letters.map((l) => l.authorId))];
  const [articles, authors, identity, reservationRows] = await Promise.all([
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
    getSpaceDisplayNameMap(req.params.id as string, authorIds),
    db.select({
      spaceLetterId: spaceScheduledSendsTable.spaceLetterId,
      status: spaceScheduledSendsTable.status,
      createdAt: spaceScheduledSendsTable.createdAt,
      scheduledAt: spaceScheduledSendsTable.scheduledAt,
      reservedRoundId: spaceScheduledSendsTable.reservedRoundId,
      reservedDate: spaceScheduledSendsTable.reservedDate,
      slotId: spaceScheduledSendsTable.slotId,
      reservationAuthorId: spaceScheduledSendsTable.reservationAuthorId,
    }).from(spaceScheduledSendsTable).where(inArray(spaceScheduledSendsTable.spaceLetterId, letters.map((l) => l.id))),
  ]);
  const articleMap = new Map(articles.map((a) => [a.id, a]));
  const authorMap = new Map(authors.map((u) => [u.id, u.nickname]));
  const currentReservationByLetter = new Map<string, typeof reservationRows[number]>();
  for (const reservation of reservationRows) {
    if (reservation.status === "CANCELLED") continue;
    const current = currentReservationByLetter.get(reservation.spaceLetterId);
    if (!current || reservation.createdAt > current.createdAt) {
      currentReservationByLetter.set(reservation.spaceLetterId, reservation);
    }
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
    const reservation = currentReservationByLetter.get(letter.id);
    const articleExcerpt = rawContent ? rawContent.replace(/[#*_`>\-~[\]()]/g, "").trim().slice(0, 100) : null;
    return {
      ...letter,
      articleTitle: article?.title ?? null,
      articleExcerpt,
      articleCover: article?.cover ?? null,
      authorNickname: identity.space?.isAnonymous
        ? (identity.displayNames.get(letter.authorId) ?? ANONYMOUS_PARTICIPANT_NAME)
        : (authorMap.get(letter.authorId) ?? null),
      displayName: identity.space?.isAnonymous
        ? (identity.displayNames.get(letter.authorId) ?? ANONYMOUS_PARTICIPANT_NAME)
        : null,
      isRead: letter.sourceArticleId ? readSet.has(letter.sourceArticleId) : false,
      reservation: reservation ? {
        status: reservation.status,
        scheduledAt: reservation.scheduledAt,
        roundId: reservation.reservedRoundId ?? null,
        date: reservation.reservedDate ?? null,
        slotId: reservation.slotId ?? null,
        authorId: reservation.reservationAuthorId ?? null,
        resolved: !!(
          reservation.reservedRoundId &&
          reservation.reservedDate &&
          reservation.reservationAuthorId
        ),
      } : null,
    };
  });
  res.json(result);
});

router.post("/spaces/:id/letters", requireAuth, async (req, res) => {
  const bodySchema = z.object({
    sourceArticleId: z.string().uuid().nullable().optional(),
    spaceRoundId: z.string().uuid().nullable().optional(),
    letterType: z.enum(["OPENING", "CENTER", "REPLY"]),
    visibility: z.enum(["PUBLIC", "RECIPIENT_ONLY"]).optional(),
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

  const [targetSpace] = await db
    .select({ status: spacesTable.status, isAnonymous: spacesTable.isAnonymous })
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id))
    .limit(1);
  if (!targetSpace) {
    res.status(404).json({ error: "Space not found" });
    return;
  }

  // Determine effective visibility: anonymous spaces always force RECIPIENT_ONLY.
  const effectiveVisibility = targetSpace.isAnonymous ? "RECIPIENT_ONLY" : (parsed.data.visibility ?? "PUBLIC");

  // OPENING letters must be tied to a round once the space is ACTIVE —
  // otherwise the letter would never surface on the detail/reservation
  // screens (both group strictly by round) and could pile up indefinitely
  // without ever being picked up. A null spaceRoundId is tolerated while the
  // space is still RECRUITING, even if rounds already exist (they can be
  // pre-created via POST /spaces/:id/rounds ahead of time): the start flow
  // creates/reuses the draft opening letter before rounds are (re)built,
  // deletes all existing rounds, then links the winning draft to round 1 —
  // so a round reference on a draft would just be wiped out by that delete.
  if (
    parsed.data.letterType === "OPENING" &&
    !parsed.data.spaceRoundId &&
    targetSpace.status === "ACTIVE"
  ) {
    res.status(400).json({ error: "여는 편지를 작성할 회차를 지정해야 합니다." });
    return;
  }

  // A caller-supplied spaceRoundId must actually belong to this space.
  if (parsed.data.spaceRoundId) {
    const [round] = await db
      .select({ id: spaceRoundsTable.id })
      .from(spaceRoundsTable)
      .where(
        and(
          eq(spaceRoundsTable.id, parsed.data.spaceRoundId),
          eq(spaceRoundsTable.spaceId, req.params.id),
        ),
      )
      .limit(1);
    if (!round) {
      res.status(400).json({ error: "존재하지 않거나 다른 공간의 회차입니다." });
      return;
    }
  }

  // If a sourceArticleId is provided, reuse an existing SpaceLetter only
  // when its role also matches. Without letterType in this key, scheduling a
  // CENTER letter could accidentally reuse an OPENING letter for the same
  // article, author, and round.
  if (parsed.data.sourceArticleId) {
    const [existing] = await db
      .select()
      .from(spaceLettersTable)
      .where(
        and(
          eq(spaceLettersTable.spaceId, req.params.id),
          eq(spaceLettersTable.sourceArticleId, parsed.data.sourceArticleId),
          eq(spaceLettersTable.authorId, req.user!.id),
          eq(spaceLettersTable.letterType, parsed.data.letterType),
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
    .values({
      ...parsed.data,
      spaceId: req.params.id,
      authorId: req.user!.id,
      visibility: effectiveVisibility,
    })
    .returning();
  res.status(201).json(letter);
});

router.patch("/spaces/:id/letters/:letterId/visibility", requireAuth, async (req, res) => {
  const bodySchema = z.object({
    visibility: z.enum(["PUBLIC", "RECIPIENT_ONLY"]),
  });
  const parsed = bodySchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.flatten() });
    return;
  }

  const callerId = req.user!.id;

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

  if (letter.authorId !== callerId) {
    res.status(403).json({ error: "Only the author can change letter visibility" });
    return;
  }

  const [space] = await db
    .select({ isAnonymous: spacesTable.isAnonymous })
    .from(spacesTable)
    .where(eq(spacesTable.id, req.params.id))
    .limit(1);
  if (!space) {
    res.status(404).json({ error: "Space not found" });
    return;
  }
  if (space.isAnonymous) {
    res.status(403).json({ error: "익명 공간의 편지 공개 설정은 변경할 수 없습니다." });
    return;
  }

  const [updated] = await db
    .update(spaceLettersTable)
    .set({ visibility: parsed.data.visibility })
    .where(eq(spaceLettersTable.id, req.params.letterId))
    .returning();
  res.json(updated);
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
async function findAssignedSlot(spaceRoundId: string, authorId: string, database: any = db) {
  const [slot] = await database
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

async function hasPendingCenterReservationConflict(
  spaceId: string,
  letter: { authorId: string; spaceRoundId: string | null },
  exceptSendId?: string,
): Promise<boolean> {
  const conditions: SQL[] = [
    eq(spaceScheduledSendsTable.spaceId, spaceId),
    eq(spaceScheduledSendsTable.status, "PENDING"),
    eq(spaceLettersTable.authorId, letter.authorId),
    eq(spaceLettersTable.letterType, "CENTER"),
    letter.spaceRoundId
      ? eq(spaceLettersTable.spaceRoundId, letter.spaceRoundId)
      : isNull(spaceLettersTable.spaceRoundId),
  ];
  if (exceptSendId) {
    conditions.push(ne(spaceScheduledSendsTable.id, exceptSendId));
  }
  const [duplicate] = await db
    .select({ id: spaceScheduledSendsTable.id })
    .from(spaceScheduledSendsTable)
    .innerJoin(spaceLettersTable, eq(spaceScheduledSendsTable.spaceLetterId, spaceLettersTable.id))
    .where(and(...conditions))
    .limit(1);
  return !!duplicate;
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
  requestedSlotId?: string,
  database: any = db,
): Promise<CenterSlotValidation> {
  if (!letter.spaceRoundId) {
    return { ok: false, error: "회차 정보가 없는 글은 예약할 수 없습니다." };
  }
  const slot = await findAssignedSlot(letter.spaceRoundId, letter.authorId, database);
  if (!slot) {
    return { ok: false, error: "이 회차에 배정된 슬롯이 없습니다." };
  }
  if (requestedSlotId !== slot.id) {
    return { ok: false, error: "선택한 슬롯이 이 회차의 작성자 배정 슬롯과 일치하지 않습니다." };
  }
  if (!slot.scheduledDate) {
    return { ok: false, error: "슬롯에 배정된 발신일이 없습니다." };
  }
  if (!isKstDateReservable(slot.scheduledDate)) {
    return { ok: false, error: "이 슬롯의 예약 가능 시간이 지났습니다." };
  }
  if (normalizedScheduledAt && kstDateString(normalizedScheduledAt) !== slot.scheduledDate) {
    return { ok: false, error: "요청한 발신 예정일이 배정된 슬롯 날짜와 일치하지 않습니다." };
  }
  return { ok: true, slot };
}

async function lockAndCheckPendingCenterReservation(
  tx: any,
  input: { spaceId: string; roundId: string; authorId: string; exceptSendId?: string },
): Promise<boolean> {
  // This remains the serialization guarantee when an old duplicate prevents
  // the optional partial unique index from being installed.
  await tx.execute(sql`SELECT pg_advisory_xact_lock(
    hashtextextended(${`${input.spaceId}:${input.roundId}:${input.authorId}`}, 0)
  )`);
  const conditions: SQL[] = [
    eq(spaceScheduledSendsTable.spaceId, input.spaceId),
    eq(spaceScheduledSendsTable.status, "PENDING"),
    eq(spaceScheduledSendsTable.reservedRoundId, input.roundId),
    eq(spaceScheduledSendsTable.reservationAuthorId, input.authorId),
  ];
  if (input.exceptSendId) conditions.push(ne(spaceScheduledSendsTable.id, input.exceptSendId));
  const [existing] = await tx.select({ id: spaceScheduledSendsTable.id })
    .from(spaceScheduledSendsTable).where(and(...conditions)).limit(1);
  return !!existing;
}

/**
 * Validates that an OPENING-role reservation's requested date is on or
 * before the letter's round's start date — an opening letter "opens" the
 * round, so it can never be scheduled after the round has already started.
 * Returns an error message string on failure, or null on success.
 */
type OpeningRoundValidation = { ok: true } | { ok: false; error: string };

async function validateOpeningRoundDate(
  letter: { spaceRoundId: string | null; spaceId: string },
  normalizedScheduledAt: Date | undefined,
): Promise<OpeningRoundValidation> {
  // Determine the deadline: use the assigned round's startsAt if present,
  // otherwise fall back to the first scheduled round of the space.
  // RECRUITING-phase draft opening letters intentionally have no spaceRoundId
  // (it is linked to round 1 by startSpace later), so we must not reject them.
  let startsAt: Date | null | undefined;
  if (letter.spaceRoundId) {
    const [round] = await db
      .select({ startsAt: spaceRoundsTable.startsAt })
      .from(spaceRoundsTable)
      .where(eq(spaceRoundsTable.id, letter.spaceRoundId))
      .limit(1);
    if (!round) {
      return { ok: false, error: "회차 정보를 찾을 수 없습니다." };
    }
    startsAt = round.startsAt;
  } else {
    // No round assigned yet — find the earliest round in this space that has
    // a start date set, which represents the first round's planned start.
    const [firstRound] = await db
      .select({ startsAt: spaceRoundsTable.startsAt })
      .from(spaceRoundsTable)
      .where(
        and(
          eq(spaceRoundsTable.spaceId, letter.spaceId),
          isNotNull(spaceRoundsTable.startsAt),
        ),
      )
      .orderBy(asc(spaceRoundsTable.startsAt))
      .limit(1);
    startsAt = firstRound?.startsAt;
  }
  if (!startsAt) {
    if (letter.spaceRoundId) {
      // Round is assigned but has no start date — unexpected state.
      return { ok: false, error: "회차 시작일 정보가 없어 여는 편지를 예약할 수 없습니다." };
    }
    // RECRUITING phase: no round has a start date yet.
    // Per the comment above, we must not reject these letters.
    // Skip the upper-bound check and apply only the min-date guard below.
  }
  // Mirrors the client's getMinOpeningDate(): before 06:00 KST, today is
  // still a valid earliest date; at/after 06:00 KST, only tomorrow onward.
  // computeDeliverySlot() already encodes exactly this cutoff.
  const minAllowedDate = kstDateString(computeDeliverySlot());
  if (normalizedScheduledAt && kstDateString(normalizedScheduledAt) < minAllowedDate) {
    return { ok: false, error: "선택한 날짜는 더 이상 예약할 수 없어요. 다른 날짜를 선택해주세요." };
  }
  if (startsAt && normalizedScheduledAt && kstDateString(normalizedScheduledAt) > kstDateString(startsAt)) {
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

  const parsedBody = z.object({
    scheduledAt: z.string().datetime(),
    slotId: z.string().uuid().optional(),
  }).strict().safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Invalid request body", details: parsedBody.error.flatten() });
    return;
  }
  const parsedScheduledAt = toDate(parsedBody.data.scheduledAt);
  if (!parsedScheduledAt) {
    res.status(400).json({ error: "잘못된 발신 시각입니다." });
    return;
  }
  // Reservation send times are always normalized to KST 06:00, regardless of
  // whatever date/time value the client actually sent.
  const normalizedScheduledAt = normalizeToKst6(parsedScheduledAt);

  let resolvedSlotId: string | undefined;
  let reservationIdentity: {
    reservedRoundId: string;
    reservedDate: string;
    reservationAuthorId: string;
  } | undefined;
  if (letter.letterType !== "CENTER" && parsedBody.data.slotId) {
    res.status(400).json({ error: "CENTER 예약이 아닌 경우 slotId를 지정할 수 없습니다." });
    return;
  }
  if (letter.letterType === "CENTER") {
    if (!parsedBody.data.slotId) {
      res.status(400).json({ error: "CENTER 예약에는 slotId가 필요합니다." });
      return;
    }
  } else if (letter.letterType === "OPENING") {
    const validation = await validateOpeningRoundDate(letter, normalizedScheduledAt);
    if (!validation.ok) {
      res.status(400).json({ error: validation.error });
      return;
    }
  }

  try {
    const [send] = await db.transaction(async (tx) => {
      if (letter.letterType === "CENTER") {
        // Re-read after the advisory lock and lock both mutable records.  The
        // binding used below is therefore one atomic observation, not the
        // earlier authorization-time read.
        await tx.execute(sql`SELECT pg_advisory_xact_lock(
          hashtextextended(${`${req.params.id}:${letter.spaceRoundId}:${letter.authorId}`}, 0)
        )`);
        await tx.execute(sql`SELECT id FROM space_letters WHERE id = ${req.params.letterId} FOR UPDATE`);
        const [lockedLetter] = await tx.select().from(spaceLettersTable).where(and(
          eq(spaceLettersTable.id, req.params.letterId),
          eq(spaceLettersTable.spaceId, req.params.id),
          eq(spaceLettersTable.authorId, callerId),
          eq(spaceLettersTable.letterType, "CENTER"),
        )).limit(1);
        if (!lockedLetter) throw Object.assign(new Error("letter changed"), { code: "23505", constraint: "space_scheduled_sends_pending_center_reservation_unique" });
        const validation = await validateCenterSlotDate(
          lockedLetter, normalizedScheduledAt, parsedBody.data.slotId, tx,
        );
        if (!validation.ok) throw Object.assign(new Error(validation.error), { statusCode: 400 });
        await tx.execute(sql`SELECT id FROM space_round_slots WHERE id = ${validation.slot.id} FOR UPDATE`);
        const lockedValidation = await validateCenterSlotDate(
          lockedLetter, normalizedScheduledAt, parsedBody.data.slotId, tx,
        );
        if (!lockedValidation.ok) throw Object.assign(new Error(lockedValidation.error), { statusCode: 400 });
        resolvedSlotId = lockedValidation.slot.id;
        reservationIdentity = {
          reservedRoundId: lockedValidation.slot.spaceRoundId,
          reservedDate: lockedValidation.slot.scheduledDate!,
          reservationAuthorId: lockedLetter.authorId,
        };
        if (await lockAndCheckPendingCenterReservation(tx, {
          spaceId: String(req.params.id), roundId: reservationIdentity.reservedRoundId,
          authorId: reservationIdentity.reservationAuthorId,
        })) {
          throw Object.assign(new Error("pending CENTER reservation conflict"), { code: "23505", constraint: "space_scheduled_sends_pending_center_reservation_unique" });
        }
      }
      return tx.insert(spaceScheduledSendsTable).values({
        spaceId: req.params.id, spaceLetterId: req.params.letterId,
        scheduledAt: normalizedScheduledAt,
        ...(resolvedSlotId != null ? { slotId: resolvedSlotId } : {}),
        ...reservationIdentity,
      }).returning();
    });
    req.log.info(
      {
        event: "operational.scheduled_send_created",
        correlationId: getCorrelationId(req),
        scheduledSendId: send?.id,
      },
      "scheduled send reservation created",
    );
    res.status(201).json(send);
  } catch (err) {
    if ((err as { statusCode?: number }).statusCode === 400) {
      res.status(400).json({ error: (err as Error).message });
      return;
    }
    const pg = getPgError(err);
    if (pg.code === "23505" && pg.constraint === "space_scheduled_sends_pending_center_reservation_unique") {
      res.status(409).json({ error: "이미 같은 회차·역할로 대기 중인 예약이 있습니다." });
      return;
    }
    throw err;
  }
});

router.patch("/spaces/:id/letters/:letterId/scheduled-sends/:sendId", requireAuth, async (req, res) => {
  const callerId = req.user!.id;
  const allowed = await canManageLetterSends(req.params.id, req.params.letterId, callerId);
  if (!allowed) {
    res.status(403).json({ error: "You can only update scheduled sends for your own letters" });
    return;
  }
  const parsedBody = z.object({
    status: z.enum(["PENDING", "CANCELLED"]).optional(),
    scheduledAt: z.string().datetime().optional(),
  }).strict().refine((value) => value.status !== undefined || value.scheduledAt !== undefined, {
    message: "At least one field is required",
  }).safeParse(req.body);
  if (!parsedBody.success) {
    res.status(400).json({ error: "Invalid request body", details: parsedBody.error.flatten() });
    return;
  }
  const { status, scheduledAt } = parsedBody.data;
  const [existingSend] = await db
    .select()
    .from(spaceScheduledSendsTable)
    .where(
      and(
        eq(spaceScheduledSendsTable.id, req.params.sendId),
        eq(spaceScheduledSendsTable.spaceLetterId, req.params.letterId),
        eq(spaceScheduledSendsTable.spaceId, req.params.id),
      ),
    )
    .limit(1);
  if (!existingSend) {
    res.status(404).json({ error: "Scheduled send not found" });
    return;
  }
  if (existingSend.status === "SENT") {
    res.status(409).json({ error: "이미 발신된 예약은 변경하거나 재활성화할 수 없습니다." });
    return;
  }
  if (status === "PENDING" && !["CANCELLED", "FAILED", "PENDING"].includes(existingSend.status)) {
    res.status(409).json({ error: "현재 예약 상태에서는 대기 상태로 전환할 수 없습니다." });
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

  const updateFields: Record<string, unknown> =
    status !== undefined ? { status } : {};
  let normalizedScheduledAt: Date | undefined;
  if (scheduledAt !== undefined) {
    const parsedScheduledAt = toDate(scheduledAt);
    if (!parsedScheduledAt) {
      res.status(400).json({ error: "잘못된 발신 시각입니다." });
      return;
    }
    normalizedScheduledAt = normalizeToKst6(parsedScheduledAt);
    updateFields.scheduledAt = normalizedScheduledAt;
  }
  // A status-only transition back to PENDING must not bypass the same date
  // checks as a new or rescheduled reservation. In that case validate the
  // stored date; otherwise validate the requested normalized date.
  if (scheduledAt !== undefined || status === "PENDING") {
    const effectiveScheduledAt = normalizedScheduledAt ?? existingSend.scheduledAt;
    if (letter.letterType === "OPENING") {
      const validation = await validateOpeningRoundDate(letter, effectiveScheduledAt);
      if (!validation.ok) {
        res.status(400).json({ error: validation.error });
        return;
      }
    }
  }
  try {
    const [send] = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT id FROM space_scheduled_sends WHERE id = ${existingSend.id} FOR UPDATE`);
      const [lockedSend] = await tx.select().from(spaceScheduledSendsTable).where(and(
        eq(spaceScheduledSendsTable.id, existingSend.id),
        eq(spaceScheduledSendsTable.spaceId, req.params.id),
        eq(spaceScheduledSendsTable.spaceLetterId, req.params.letterId),
      )).limit(1);
      if (!lockedSend || lockedSend.status !== existingSend.status || lockedSend.status === "SENT") {
        throw Object.assign(new Error("scheduled send state changed"), { code: "23505", constraint: "space_scheduled_sends_pending_center_reservation_unique" });
      }
      if (lockedSend.reservedRoundId && lockedSend.reservationAuthorId) {
        await tx.execute(sql`SELECT pg_advisory_xact_lock(
          hashtextextended(${`${req.params.id}:${lockedSend.reservedRoundId}:${lockedSend.reservationAuthorId}`}, 0)
        )`);
      }
      const [lockedLetter] = await tx.select().from(spaceLettersTable).where(and(
        eq(spaceLettersTable.id, lockedSend.spaceLetterId),
        eq(spaceLettersTable.spaceId, req.params.id),
      )).limit(1);
      if (!lockedLetter || lockedLetter.authorId !== callerId) {
        throw Object.assign(new Error("letter changed"), { code: "23505", constraint: "space_scheduled_sends_pending_center_reservation_unique" });
      }
      if (lockedLetter.letterType === "CENTER" && (scheduledAt !== undefined || status === "PENDING")) {
        if (!lockedSend.reservedRoundId || !lockedSend.reservationAuthorId || !lockedSend.slotId) {
          throw Object.assign(new Error("unresolved CENTER reservation"), { code: "23505", constraint: "space_scheduled_sends_pending_center_reservation_unique" });
        }
        await tx.execute(sql`SELECT id FROM space_letters WHERE id = ${lockedLetter.id} FOR UPDATE`);
        await tx.execute(sql`SELECT id FROM space_round_slots WHERE id = ${lockedSend.slotId} FOR UPDATE`);
        const validation = await validateCenterSlotDate(
          lockedLetter, normalizedScheduledAt ?? lockedSend.scheduledAt, lockedSend.slotId, tx,
        );
        if (!validation.ok) throw Object.assign(new Error(validation.error), { statusCode: 400 });
        if (
          lockedSend.reservedRoundId !== validation.slot.spaceRoundId ||
          lockedSend.reservedDate !== validation.slot.scheduledDate ||
          lockedSend.reservationAuthorId !== lockedLetter.authorId
        ) {
          throw Object.assign(new Error("예약 당시의 회차·슬롯·날짜 정보가 현재 배정과 일치하지 않습니다."), { statusCode: 409 });
        }
        if (await lockAndCheckPendingCenterReservation(tx, {
          spaceId: String(req.params.id),
          roundId: lockedSend.reservedRoundId,
          authorId: lockedSend.reservationAuthorId,
          exceptSendId: lockedSend.id,
        })) {
          throw Object.assign(new Error("pending CENTER reservation conflict"), { code: "23505", constraint: "space_scheduled_sends_pending_center_reservation_unique" });
        }
      }
      return tx.update(spaceScheduledSendsTable)
        .set(updateFields)
        .where(
          and(
            eq(spaceScheduledSendsTable.id, req.params.sendId),
            eq(spaceScheduledSendsTable.spaceLetterId, req.params.letterId),
            eq(spaceScheduledSendsTable.spaceId, req.params.id),
            eq(spaceScheduledSendsTable.status, lockedSend.status),
          ),
        )
        .returning();
    });
    res.json(send);
  } catch (err) {
    const statusCode = (err as { statusCode?: number }).statusCode;
    if (statusCode === 400 || statusCode === 409) {
      res.status(statusCode).json({ error: (err as Error).message });
      return;
    }
    const pg = getPgError(err);
    if (pg.code === "23505" && pg.constraint === "space_scheduled_sends_pending_center_reservation_unique") {
      res.status(409).json({ error: "이미 같은 회차·역할로 대기 중인 예약이 있습니다." });
      return;
    }
    throw err;
  }
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
  await processDueScheduledSends({
    spaceId: req.params.id,
    correlationId: getCorrelationId(req),
  });
  // Reservation ownership is the same for operators and participants. An
  // operator may manage other space content, but this screen is the personal
  // reservation list and must never expose another member's reservation
  // metadata or let it affect the derived empty-slot state in the client.
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
  const sends = rows.map((r) => r.send);
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
  const roundIds = [...new Set([
    ...letters.map((l) => l.spaceRoundId),
    ...sends.map((s) => s.reservedRoundId),
  ].filter(Boolean) as string[])];
  const slotIds = [...new Set(sends.map((s) => s.slotId).filter(Boolean) as string[])];

  const [articles, authors, space, rounds, slots, identity] = await Promise.all([
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
    getSpaceDisplayNameMap(req.params.id as string, authorIds),
  ]);

  const articleMap = new Map(articles.map((a) => [a.id, a.title]));
  const authorMap = new Map(authors.map((u) => [u.id, u.nickname]));
  const roundMap = new Map(rounds.map((r) => [r.id, r]));
  const slotMap = new Map(slots.map((s) => [s.id, s]));

  const result = sends.map((send) => {
    const letter = letterMap.get(send.spaceLetterId) ?? null;
    const articleTitle = letter?.sourceArticleId ? (articleMap.get(letter.sourceArticleId) ?? null) : null;
    const authorNickname = !letter
      ? null
      : space?.isAnonymous
        ? (identity.displayNames.get(letter.authorId) ?? ANONYMOUS_PARTICIPANT_NAME)
        : (authorMap.get(letter.authorId) ?? null);

    const round = send.reservedRoundId ? (roundMap.get(send.reservedRoundId) ?? null) : null;
    const slot = send.slotId ? (slotMap.get(send.slotId) ?? null) : null;

    return {
      ...send,
      letter,
      articleTitle,
      authorNickname,
      // Do not infer a historical reservation from the current letter/slot.
      // Null fields explicitly mean an unresolved pre-identity reservation.
      reservation: {
        status: send.status,
        scheduledAt: send.scheduledAt,
        roundId: send.reservedRoundId ?? null,
        roundNumber: round?.roundNumber ?? null,
        slotId: send.slotId ?? null,
        date: send.reservedDate ?? null,
        authorId: send.reservationAuthorId ?? null,
        resolved: !!(
          send.reservedRoundId &&
          send.reservedDate &&
          send.reservationAuthorId &&
          slot &&
          slot.spaceRoundId === send.reservedRoundId &&
          slot.scheduledDate === send.reservedDate &&
          slot.assignedUserId === send.reservationAuthorId
        ),
      },
      roundNumber: round?.roundNumber ?? null,
      totalRounds: space?.roundCount ?? null,
      letterType: letter?.letterType ?? null,
      slotScheduledDate: send.reservedDate ?? null,
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

  const [participantCounts, creatorParticipations] = await Promise.all([
    db
      .select({ spaceId: spaceParticipationsTable.spaceId, value: count() })
      .from(spaceParticipationsTable)
    .where(
        and(
          inArray(spaceParticipationsTable.spaceId, spaceIds),
          eq(spaceParticipationsTable.status, "APPROVED"),
        ne(spaceParticipationsTable.role, "OPERATOR"),
        ),
      )
      .groupBy(spaceParticipationsTable.spaceId),
    db
      .select({
        spaceId: spaceParticipationsTable.spaceId,
        userId: spaceParticipationsTable.userId,
        spaceNickname: spaceParticipationsTable.spaceNickname,
      })
      .from(spaceParticipationsTable)
      .where(
        and(
          inArray(spaceParticipationsTable.spaceId, spaceIds),
          eq(spaceParticipationsTable.status, "APPROVED"),
        ),
      ),
  ]);
  const countMap = Object.fromEntries(participantCounts.map((pc) => [pc.spaceId, pc.value]));
  const creatorParticipationMap = new Map(
    creatorParticipations.map((participation) => [
      `${participation.spaceId}:${participation.userId}`,
      participation,
    ]),
  );

  const spaceMap = Object.fromEntries(
    spaces.map((s) => [
      s.id,
      {
        ...s,
        creatorNickname: s.isAnonymous
          ? getAnonymousDisplayName(
              s,
              creatorParticipationMap.get(`${s.id}:${s.creatorId}`)?.spaceNickname,
            )
          : (creatorMap[s.creatorId] ?? null),
        participantCount: countMap[s.id] ?? 0,
      },
    ]),
  );

  const result = invitations
    .filter((inv) => spaceMap[inv.spaceId])
    .map((inv) => ({ invitation: inv, space: spaceMap[inv.spaceId] }));

  res.json(result);
});

export default router;
