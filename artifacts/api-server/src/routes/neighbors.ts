import { Router, type IRouter } from "express";
import { and, eq, or } from "drizzle-orm";
import { db, inboxTable, neighborsTable, neighborRequestsTable, sendRecordsTable, usersTable } from "@workspace/db";
import { CreateNeighborRequestBody } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { calculateRelationshipMetrics } from "../lib/relationshipMetrics";

const router: IRouter = Router();

router.get("/relationship-metrics", requireAuth, async (_req, res) => {
  const [neighbors, sends, inboxRows] = await Promise.all([
    db.select({
      userAId: neighborsTable.userAId,
      userBId: neighborsTable.userBId,
      createdAt: neighborsTable.createdAt,
      acceptedAt: neighborsTable.acceptedAt,
    }).from(neighborsTable),
    db.select({
      id: sendRecordsTable.id,
      senderId: sendRecordsTable.senderId,
      recipientId: sendRecordsTable.recipientId,
      inboxId: sendRecordsTable.inboxId,
      replyToInboxId: sendRecordsTable.replyToInboxId,
      targetType: sendRecordsTable.targetType,
      deliverySlot: sendRecordsTable.deliverySlot,
      sentAt: sendRecordsTable.sentAt,
    }).from(sendRecordsTable),
    db.select({
      id: inboxTable.id,
      openedAt: inboxTable.openedAt,
    }).from(inboxTable),
  ]);
  res.json(calculateRelationshipMetrics(neighbors, sends, inboxRows));
});

router.get("/neighbors", async (req, res) => {
  const { userId } = req.query;
  if (!userId || typeof userId !== "string") {
    res.status(400).json({ error: "userId is required" });
    return;
  }

  const asA = await db
    .select({
      id: neighborsTable.id,
      neighborUserId: neighborsTable.userBId,
      createdAt: neighborsTable.createdAt,
      acceptedAt: neighborsTable.acceptedAt,
    })
    .from(neighborsTable)
    .where(eq(neighborsTable.userAId, userId));

  const asB = await db
    .select({
      id: neighborsTable.id,
      neighborUserId: neighborsTable.userAId,
      createdAt: neighborsTable.createdAt,
      acceptedAt: neighborsTable.acceptedAt,
    })
    .from(neighborsTable)
    .where(eq(neighborsTable.userBId, userId));

  const all = [...asA, ...asB];

  const results = [];
  for (const n of all) {
    const [user] = await db.select().from(usersTable).where(eq(usersTable.id, n.neighborUserId));
    results.push({ ...n, user: user ?? null });
  }

  res.json(results);
});

router.get("/neighbors/:id", async (req, res) => {
  const [neighbor] = await db.select().from(neighborsTable).where(eq(neighborsTable.id, req.params.id));
  if (!neighbor) {
    res.status(404).json({ error: "Neighbor not found" });
    return;
  }
  res.json(neighbor);
});

router.delete("/neighbors/:id", async (req, res) => {
  const [deleted] = await db.delete(neighborsTable).where(eq(neighborsTable.id, req.params.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Neighbor not found" });
    return;
  }
  res.status(204).send();
});

router.get("/neighbor-requests", async (req, res) => {
  const { recipientId, requesterId } = req.query;

  if (requesterId && typeof requesterId === "string") {
    const requests = await db
      .select({
        id: neighborRequestsTable.id,
        requesterId: neighborRequestsTable.requesterId,
        recipientId: neighborRequestsTable.recipientId,
        status: neighborRequestsTable.status,
        createdAt: neighborRequestsTable.createdAt,
      })
      .from(neighborRequestsTable)
      .where(and(
        eq(neighborRequestsTable.requesterId, requesterId),
        eq(neighborRequestsTable.status, "PENDING"),
      ));

    const results = [];
    for (const r of requests) {
      const [recipient] = await db.select().from(usersTable).where(eq(usersTable.id, r.recipientId));
      results.push({ ...r, recipient: recipient ?? null });
    }

    res.json(results);
    return;
  }

  if (!recipientId || typeof recipientId !== "string") {
    res.status(400).json({ error: "recipientId or requesterId is required" });
    return;
  }

  const requests = await db
    .select({
      id: neighborRequestsTable.id,
      requesterId: neighborRequestsTable.requesterId,
      recipientId: neighborRequestsTable.recipientId,
      status: neighborRequestsTable.status,
      createdAt: neighborRequestsTable.createdAt,
      requester: usersTable,
    })
    .from(neighborRequestsTable)
    .leftJoin(usersTable, eq(neighborRequestsTable.requesterId, usersTable.id))
    .where(and(
      eq(neighborRequestsTable.recipientId, recipientId),
      eq(neighborRequestsTable.status, "PENDING"),
    ));

  res.json(requests);
});

router.get("/neighbor-requests/:id", async (req, res) => {
  const [request] = await db.select().from(neighborRequestsTable).where(eq(neighborRequestsTable.id, req.params.id));
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  res.json(request);
});

router.post("/neighbor-requests", async (req, res) => {
  const parsed = CreateNeighborRequestBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.issues[0]?.message ?? "Validation error" });
    return;
  }
  const { requesterId, recipientId } = parsed.data;

  if (requesterId === recipientId) {
    res.status(400).json({ error: "Cannot send neighbor request to yourself" });
    return;
  }

  const [aId, bId] = requesterId < recipientId ? [requesterId, recipientId] : [recipientId, requesterId];
  const existingNeighbor = await db.select().from(neighborsTable)
    .where(and(eq(neighborsTable.userAId, aId), eq(neighborsTable.userBId, bId)));

  if (existingNeighbor.length > 0) {
    res.status(400).json({ error: "Already neighbors" });
    return;
  }

  const existingRequest = await db.select().from(neighborRequestsTable)
    .where(or(
      and(eq(neighborRequestsTable.requesterId, requesterId), eq(neighborRequestsTable.recipientId, recipientId)),
      and(eq(neighborRequestsTable.requesterId, recipientId), eq(neighborRequestsTable.recipientId, requesterId)),
    ));

  if (existingRequest.length > 0) {
    res.status(200).json(existingRequest[0]);
    return;
  }

  try {
    const [request] = await db.insert(neighborRequestsTable).values({
      requesterId,
      recipientId,
      status: "PENDING",
    }).returning();

    res.status(201).json(request);
  } catch (err: unknown) {
    const isUniqueViolation =
      err instanceof Error && "code" in err && (err as { code: string }).code === "23505";
    if (isUniqueViolation) {
      const [existing] = await db.select().from(neighborRequestsTable)
        .where(and(eq(neighborRequestsTable.requesterId, requesterId), eq(neighborRequestsTable.recipientId, recipientId)));
      if (existing) {
        res.status(200).json(existing);
        return;
      }
    }
    throw err;
  }
});

router.delete("/neighbor-requests/:id", async (req, res) => {
  const [deleted] = await db.delete(neighborRequestsTable).where(eq(neighborRequestsTable.id, req.params.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  res.status(204).send();
});

router.post("/neighbor-requests/:id/accept", async (req, res) => {
  const [request] = await db.select().from(neighborRequestsTable).where(eq(neighborRequestsTable.id, req.params.id));
  if (!request) {
    res.status(404).json({ error: "Request not found" });
    return;
  }

  const [aId, bId] = request.requesterId < request.recipientId
    ? [request.requesterId, request.recipientId]
    : [request.recipientId, request.requesterId];

  const neighbor = await db.transaction(async (tx) => {
    const [n] = await tx.insert(neighborsTable).values({
      userAId: aId,
      userBId: bId,
      createdAt: request.createdAt,
      acceptedAt: new Date(),
    }).returning();

    await tx.delete(neighborRequestsTable).where(eq(neighborRequestsTable.id, req.params.id));

    return n;
  });

  res.json(neighbor);
});

router.post("/neighbor-requests/:id/reject", async (req, res) => {
  const [deleted] = await db.delete(neighborRequestsTable).where(eq(neighborRequestsTable.id, req.params.id)).returning();
  if (!deleted) {
    res.status(404).json({ error: "Request not found" });
    return;
  }
  res.status(204).send();
});

export default router;
