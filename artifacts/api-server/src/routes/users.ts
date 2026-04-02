import { Router, type IRouter } from "express";
import { and, eq } from "drizzle-orm";
import { db, usersTable, myCollectionsTable } from "@workspace/db";
import { CreateUserBody, UpdateUserBody, UpdateUserRecentCollectionBody } from "@workspace/api-zod";

const router: IRouter = Router();

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
