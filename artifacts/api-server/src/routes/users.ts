import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db, usersTable, myCollectionsTable, neighborsTable, neighborRequestsTable, teamCollectionMembershipsTable, spaceLettersTable, articlesTable } from "@workspace/db";
import type { Neighbor, NeighborRequest } from "@workspace/db";
import { CreateUserBody, UpdateUserBody, UpdateUserRecentCollectionBody } from "@workspace/api-zod";
import { requireAuth, resolveCallerId } from "../middlewares/requireAuth";
import { logger } from "../lib/logger";

const router: IRouter = Router();

type UserSyncDatabase = Pick<typeof db, "insert" | "select">;
type UserSyncLogger = Pick<typeof logger, "info" | "warn" | "error">;

interface UserSyncDependencies {
  database?: UserSyncDatabase;
  log?: UserSyncLogger;
}

function getAuthFlowId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  return /^af_[a-z0-9]{12,24}$/.test(value) ? value : null;
}

function syncError(res: Response, status: number, code: string, flowId: string | null) {
  res.status(status).json({
    error: "User profile synchronization failed",
    code,
    ...(flowId ? { diagnosticId: flowId } : {}),
  });
}

function getPgCode(err: unknown): string | null {
  if (!err || typeof err !== "object") return null;
  const candidate = err as {
    code?: unknown;
    cause?: { code?: unknown };
  };
  if (typeof candidate.cause?.code === "string") return candidate.cause.code;
  return typeof candidate.code === "string" ? candidate.code : null;
}

function deriveNicknameFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  const sanitized = local.replace(/[^A-Za-z0-9가-힣._-]/g, "").trim();
  const fallback = sanitized.length > 0 ? sanitized : "user";
  return fallback.slice(0, 20);
}

export function createUserSyncHandler({
  database = db,
  log = logger,
}: UserSyncDependencies = {}) {
  return async (req: Request, res: Response) => {
    const flowId = getAuthFlowId(req.headers["x-auth-flow-id"]);
    const { id, email, nickname } = req.body ?? {};
    if (!id || typeof id !== "string" || !email || typeof email !== "string") {
      syncError(res, 400, "SYNC_INVALID_REQUEST", flowId);
      log.warn({ flowId, code: "SYNC_INVALID_REQUEST" }, "users/sync rejected");
      return;
    }
    const authenticatedEmail = req.user?.email;
    if (
      req.user?.id !== id ||
      !authenticatedEmail ||
      authenticatedEmail.toLowerCase() !== email.toLowerCase()
    ) {
      syncError(res, 403, "SYNC_IDENTITY_MISMATCH", flowId);
      log.warn({ flowId, code: "SYNC_IDENTITY_MISMATCH" }, "users/sync rejected");
      return;
    }

    const trimmedNickname =
      typeof nickname === "string" && nickname.trim().length > 0
        ? nickname.trim().slice(0, 20)
        : null;

    // Always upsert so accounts created out-of-band (e.g. directly in the auth
    // dashboard) end up with a `users` row on first login. When the client did
    // not supply a nickname, fall back to the email local-part so search,
    // membership FKs, and neighbor requests can still resolve the user.
    const resolvedNickname = trimmedNickname ?? deriveNicknameFromEmail(email);

    try {
      const [user] = await database
        .insert(usersTable)
        .values({ id, email, nickname: resolvedNickname })
        .onConflictDoUpdate({
          target: usersTable.id,
          // Preserve the existing nickname; only refresh email + updatedAt. If
          // the caller explicitly provided a nickname we honor it.
          set: trimmedNickname
            ? { email, nickname: trimmedNickname, updatedAt: new Date() }
            : { email, updatedAt: new Date() },
        })
        .returning();

      log.info({ flowId, outcome: "profile-persisted" }, "users/sync completed");
      res.json({ user, ...(flowId ? { diagnosticId: flowId } : {}) });
      return;
    } catch (err: unknown) {
      // A unique email collision must not be treated as a successful sync for
      // a different authenticated identity.
      const pgCode = getPgCode(err);
      if (pgCode === "23505") {
        log.warn({ flowId, code: "SYNC_EMAIL_CONFLICT" }, "users/sync conflict");
        syncError(res, 409, "SYNC_EMAIL_CONFLICT", flowId);
        return;
      }
      log.error({ flowId, code: "SYNC_DATABASE_UNAVAILABLE" }, "users/sync database failure");
      syncError(res, 503, "SYNC_DATABASE_UNAVAILABLE", flowId);
    }
  };
}

router.post("/users/sync", requireAuth, createUserSyncHandler());

router.get("/users/search", async (req, res) => {
  const { nickname, userId, excludeTeamId } = req.query;
  if (!nickname || typeof nickname !== "string" || nickname.trim() === "") {
    res.status(400).json({ error: "nickname query param is required" });
    return;
  }
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId query param is required" });
    return;
  }

  const q = nickname.trim().toLowerCase();

  const priorityExpr = sql<number>`
    CASE
      WHEN lower(${usersTable.nickname}) LIKE ${q + "%"} THEN 0
      WHEN lower(${usersTable.email}) LIKE ${q + "%"} THEN 1
      WHEN lower(${usersTable.nickname}) LIKE ${"%" + q + "%"} THEN 2
      ELSE 3
    END
  `;

  let excludedMemberIds: string[] = [];
  if (excludeTeamId && typeof excludeTeamId === "string") {
    const memberships = await db
      .select({ userId: teamCollectionMembershipsTable.userId })
      .from(teamCollectionMembershipsTable)
      .where(eq(teamCollectionMembershipsTable.teamCollectionId, excludeTeamId));
    excludedMemberIds = memberships.map((m) => m.userId);
  }

  const whereConditions = and(
    or(
      ilike(usersTable.nickname, `%${q}%`),
      ilike(usersTable.email, `%${q}%`),
    ),
    ne(usersTable.id, userId),
    excludedMemberIds.length > 0 ? sql`${usersTable.id} NOT IN (${sql.join(excludedMemberIds.map((id) => sql`${id}`), sql`, `)})` : sql`TRUE`,
  );

  const matchingUsers = await db
    .select()
    .from(usersTable)
    .where(whereConditions)
    .orderBy(
      priorityExpr,
      sql`lower(${usersTable.nickname})`,
      sql`lower(${usersTable.email})`,
    )
    .limit(20);

  if (matchingUsers.length === 0) {
    res.json([]);
    return;
  }

  const candidateIds = matchingUsers.map((u) => u.id);

  const neighborRows = await db
    .select()
    .from(neighborsTable)
    .where(
      or(
        and(eq(neighborsTable.userAId, userId), inArray(neighborsTable.userBId, candidateIds)),
        and(eq(neighborsTable.userBId, userId), inArray(neighborsTable.userAId, candidateIds)),
      ),
    );

  const neighborUserIds = new Set(
    neighborRows.map((n: Neighbor) => (n.userAId === userId ? n.userBId : n.userAId)),
  );

  const pendingRows = await db
    .select()
    .from(neighborRequestsTable)
    .where(
      or(
        and(eq(neighborRequestsTable.requesterId, userId), inArray(neighborRequestsTable.recipientId, candidateIds)),
        and(eq(neighborRequestsTable.recipientId, userId), inArray(neighborRequestsTable.requesterId, candidateIds)),
      ),
    );

  const pendingByUserId = new Map<string, string>();
  for (const r of pendingRows as NeighborRequest[]) {
    const otherUserId = r.requesterId === userId ? r.recipientId : r.requesterId;
    pendingByUserId.set(otherUserId, r.id);
  }

  const results = matchingUsers.map((u: typeof matchingUsers[0]) => {
    const isPending = pendingByUserId.has(u.id);
    return {
      id: u.id,
      nickname: u.nickname,
      email: u.email,
      avatarUrl: u.avatarUrl,
      status: neighborUserIds.has(u.id)
        ? "neighbor"
        : isPending
          ? "pending"
          : "none",
      requestId: isPending ? pendingByUserId.get(u.id) : undefined,
    };
  });

  res.json(results);
});

router.get("/users", async (_req, res) => {
  const users = await db.select().from(usersTable);
  res.json(users);
});

router.post("/users", async (req, res) => {
  const parsed = CreateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { email, nickname, avatarUrl } = parsed.data;
  const [user] = await db.insert(usersTable).values({ email, nickname, avatarUrl: avatarUrl ?? null }).returning();
  res.status(201).json(user);
});

router.get("/users/:id", async (req, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

router.patch("/users/:id", async (req, res) => {
  const parsed = UpdateUserBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const updates: Record<string, unknown> = {};
  if (parsed.data.nickname !== undefined) updates.nickname = parsed.data.nickname;
  if (parsed.data.avatarUrl !== undefined) updates.avatarUrl = parsed.data.avatarUrl;

  if (Object.keys(updates).length === 0) {
    res.status(400).json({ error: "No fields to update" });
    return;
  }

  const [user] = await db.update(usersTable).set(updates).where(eq(usersTable.id, req.params.id)).returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json(user);
});

router.delete("/users/:id", async (req, res) => {
  const [deleted] = await db.delete(usersTable).where(eq(usersTable.id, req.params.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.status(204).send();
});

router.get("/users/:id/space-letters", async (req, res) => {
  const [user] = await db.select({ id: usersTable.id }).from(usersTable).where(eq(usersTable.id, req.params.id)).limit(1);
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }

  // Authenticated owners receive all space letters (PUBLIC + RECIPIENT_ONLY) so
  // the client can drive the visibility-toggle UI without a separate endpoint.
  // Unauthenticated callers and other users see PUBLIC letters only.
  const callerId = await resolveCallerId(req);
  const isOwner = callerId != null && callerId === req.params.id;

  const conditions = [eq(spaceLettersTable.authorId, req.params.id)];
  if (!isOwner) {
    conditions.push(eq(spaceLettersTable.visibility, "PUBLIC"));
  }

  const letters = await db
    .select()
    .from(spaceLettersTable)
    .where(and(...conditions));

  if (letters.length === 0) {
    res.json([]);
    return;
  }

  const articleIds = [...new Set(letters.map((l) => l.sourceArticleId).filter(Boolean) as string[])];
  const articles = articleIds.length > 0
    ? await db
        .select({ id: articlesTable.id, title: articlesTable.title, content: articlesTable.content, cover: articlesTable.cover })
        .from(articlesTable)
        .where(inArray(articlesTable.id, articleIds))
    : [];
  const articleMap = new Map(articles.map((a) => [a.id, a]));

  const result = letters.map((letter) => {
    const article = letter.sourceArticleId ? (articleMap.get(letter.sourceArticleId) ?? null) : null;
    const rawContent = article?.content ?? null;
    const articleExcerpt = rawContent ? rawContent.replace(/[#*_`>\-~[\]()]/g, "").trim().slice(0, 100) : null;
    return {
      ...letter,
      articleTitle: article?.title ?? null,
      articleExcerpt,
      articleCover: article?.cover ?? null,
      authorNickname: null,
      displayName: null,
      isRead: false,
    };
  });
  res.json(result);
});

router.get("/users/:id/recent-collection", async (req, res) => {
  const [user] = await db.select().from(usersTable).where(eq(usersTable.id, req.params.id));
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ recentSavedCollectionId: user.recentSavedCollectionId ?? null });
});

router.put("/users/:id/recent-collection", async (req, res) => {
  const parsed = UpdateUserRecentCollectionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { collectionId } = parsed.data;

  if (collectionId != null) {
    const [collection] = await db
      .select()
      .from(myCollectionsTable)
      .where(and(eq(myCollectionsTable.id, collectionId), eq(myCollectionsTable.ownerId, req.params.id)));
    if (!collection) {
      res.status(404).json({ error: "Collection not found or does not belong to user" });
      return;
    }
  }

  const [user] = await db
    .update(usersTable)
    .set({ recentSavedCollectionId: collectionId ?? null })
    .where(eq(usersTable.id, req.params.id))
    .returning();
  if (!user) {
    res.status(404).json({ error: "User not found" });
    return;
  }
  res.json({ recentSavedCollectionId: user.recentSavedCollectionId ?? null });
});

export default router;
