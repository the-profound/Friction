import { Router, type IRouter } from "express";
import { db, pushTokensTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { logger } from "../lib/logger";
import { requireAuth } from "../middlewares/requireAuth";
import { z } from "zod";

const router: IRouter = Router();

const registerPushTokenSchema = z.object({
  token: z.string().min(1),
  platform: z.enum(["ios", "android"]),
  deviceId: z.string().optional(),
});

/**
 * POST /push-tokens
 *
 * Registers (or refreshes) an Expo push token for the authenticated user.
 * Upserts on (user_id, token) so duplicate registrations only update
 * `updated_at`.
 */
router.post("/push-tokens", requireAuth, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const parsed = registerPushTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid request body", details: parsed.error.issues });
    return;
  }

  const { token, platform, deviceId } = parsed.data;

  try {
    await db
      .insert(pushTokensTable)
      .values({
        userId,
        token,
        platform,
        deviceId: deviceId ?? null,
      })
      .onConflictDoUpdate({
        target: [pushTokensTable.userId, pushTokensTable.token],
        set: { updatedAt: new Date(), platform, deviceId: deviceId ?? null },
      });

    res.status(204).send();
  } catch (err) {
    logger.error({ err, userId }, "push-tokens: upsert failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

/**
 * DELETE /push-tokens
 *
 * Removes a specific push token for the authenticated user.
 */
router.delete("/push-tokens", requireAuth, async (req, res) => {
  const userId = req.user?.id;
  if (!userId) {
    res.status(401).json({ error: "Unauthorized" });
    return;
  }

  const { token } = req.body ?? {};
  if (!token || typeof token !== "string") {
    res.status(400).json({ error: "token is required" });
    return;
  }

  try {
    await db
      .delete(pushTokensTable)
      .where(and(eq(pushTokensTable.userId, userId), eq(pushTokensTable.token, token)));

    res.status(204).send();
  } catch (err) {
    logger.error({ err, userId }, "push-tokens: delete failed");
    res.status(500).json({ error: "Internal server error" });
  }
});

export default router;
