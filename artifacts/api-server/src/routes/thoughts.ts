import { Router, type IRouter } from "express";
import { and, desc, eq, isNull } from "drizzle-orm";
import { db, thoughtsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.get("/thoughts", requireAuth, async (req, res) => {
  const userId = req.user!.id;

  const thoughts = await db
    .select({
      id: thoughtsTable.id,
      authorId: thoughtsTable.authorId,
      content: thoughtsTable.content,
      createdFrom: thoughtsTable.createdFrom,
      sourceArticleId: thoughtsTable.sourceArticleId,
      createdAt: thoughtsTable.createdAt,
      updatedAt: thoughtsTable.updatedAt,
    })
    .from(thoughtsTable)
    .where(
      and(
        eq(thoughtsTable.authorId, userId),
        isNull(thoughtsTable.deletedAt),
      ),
    )
    .orderBy(desc(thoughtsTable.createdAt));

  res.json(thoughts);
});

export default router;
