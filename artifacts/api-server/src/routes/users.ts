import { Router, type IRouter } from "express";
import { eq } from "drizzle-orm";
import { db, usersTable } from "@workspace/db";

const router: IRouter = Router();

router.get("/users", async (_req, res) => {
  const users = await db.select().from(usersTable);
  res.json(users);
});

router.post("/users", async (req, res) => {
  const { email, nickname, avatarUrl } = req.body;
  if (!email || !nickname) {
    res.status(400).json({ error: "email and nickname are required" });
    return;
  }
  if (nickname.length < 1 || nickname.length > 20) {
    res.status(400).json({ error: "nickname must be 1-20 characters" });
    return;
  }
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
  const { nickname, avatarUrl } = req.body;
  const updates: Record<string, unknown> = {};
  if (nickname !== undefined) {
    if (nickname.length < 1 || nickname.length > 20) {
      res.status(400).json({ error: "nickname must be 1-20 characters" });
      return;
    }
    updates.nickname = nickname;
  }
  if (avatarUrl !== undefined) updates.avatarUrl = avatarUrl;

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

export default router;
