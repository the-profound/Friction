import { Router, type IRouter } from "express";
import { and, eq, ilike, inArray, ne, or, sql } from "drizzle-orm";
import { db, usersTable, myCollectionsTable, neighborsTable, neighborRequestsTable, teamCollectionMembershipsTable } from "@workspace/db";
import type { Neighbor, NeighborRequest } from "@workspace/db";
import { CreateUserBody, UpdateUserBody, UpdateUserRecentCollectionBody } from "@workspace/api-zod";

const router: IRouter = Router();

router.post("/users/sync", async (req, res) => {
  const { id, email, nickname } = req.body ?? {};
  if (!id || typeof id !== "string" || !email || typeof email !== "string") {
    res.status(400).json({ error: "id and email are required" });
    return;
  }

  const resolvedNickname =
    typeof nickname === "string" && nickname.trim().length > 0
      ? nickname.trim().slice(0, 20)
      : null;

  if (resolvedNickname) {
    const [user] = await db
      .insert(usersTable)
      .values({ id, email, nickname: resolvedNickname })
      .onConflictDoUpdate({
        target: usersTable.id,
        set: { email, updatedAt: new Date() },
      })
      .returning();
    res.json(user);
    return;
  }

  const [user] = await db
    .update(usersTable)
    .set({ email, updatedAt: new Date() })
    .where(eq(usersTable.id, id))
    .returning();

  if (!user) {
    res.status(400).json({ error: "nickname is required for new user" });
    return;
  }

  res.json(user);
});

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
