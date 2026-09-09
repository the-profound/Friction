import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import {
  afterAll,
  afterEach,
  beforeAll,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { and, asc, eq } from "drizzle-orm";
import {
  db,
  pool,
  thoughtQuestionQueueTable,
  thoughtsTable,
  usersTable,
} from "@workspace/db";

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (
    req: { headers: Record<string, string | undefined>; user?: { id: string } },
    _res: unknown,
    next: () => void,
  ) => {
    const userId = req.headers["x-test-user-id"];
    if (!userId) throw new Error("x-test-user-id is required");
    req.user = { id: userId };
    next();
  },
}));

vi.mock("../services/generate-preliminary-thought-question", () => ({
  generatePreliminaryThoughtQuestion: vi.fn(async () => null),
}));

vi.mock("../services/generate-random-preliminary-thought-question", () => ({
  generateRandomPreliminaryThoughtQuestion: vi.fn(() => null),
}));

import thoughtsRouter from "./thoughts";

const hasDatabase = Boolean(process.env.SUPABASE_DB_URL);
const createdUserIds: string[] = [];

type RequestKind = "patch" | "activate";

const ANSWER = "# 답변 제목\n\n동시에 저장해도 유실되지 않는 답변 본문입니다.";

async function startServer(): Promise<{ server: Server; baseUrl: string }> {
  const app = express();
  app.use(express.json());
  app.use("/api", thoughtsRouter);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}/api` };
}

async function request(
  baseUrl: string,
  userId: string,
  thoughtId: string,
  kind: RequestKind,
) {
  const path =
    kind === "patch"
      ? `/thoughts/${thoughtId}`
      : `/thoughts/${thoughtId}/activate`;
  return fetch(`${baseUrl}${path}`, {
    method: kind === "patch" ? "PATCH" : "POST",
    headers: {
      "content-type": "application/json",
      "x-test-user-id": userId,
    },
    ...(kind === "patch" ? { body: JSON.stringify({ content: ANSWER }) } : {}),
  });
}

async function waitForQueueLockWaiters(userId: string, expected: number) {
  const lockName = `thought-question-queue:${userId}`;
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const result = await pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM pg_locks
       WHERE locktype = 'advisory'
         AND granted = false
         AND classid = CASE
           WHEN hashtext($1)::bigint < 0 THEN 4294967295
           ELSE 0
         END
         AND objsubid = 1
         AND objid = CASE
           WHEN hashtext($1)::bigint < 0
             THEN hashtext($1)::bigint + 4294967296
           ELSE hashtext($1)::bigint
         END`,
      [lockName],
    );
    if (Number(result.rows[0]?.count ?? 0) >= expected) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(
    `Timed out waiting for ${expected} PostgreSQL advisory lock waiter(s)`,
  );
}

async function seedQuestionQueue() {
  const userId = randomUUID();
  const thoughtIds = [randomUUID(), randomUUID(), randomUUID()];
  createdUserIds.push(userId);

  await db.insert(usersTable).values({
    id: userId,
    email: `question-race-${userId}@example.invalid`,
    nickname: `race-${userId.slice(0, 8)}`,
  });
  await db.insert(thoughtsTable).values(
    thoughtIds.map((id, index) => ({
      id,
      authorId: userId,
      content: `# Q. 질문 ${index + 1}?\n\n답변을 기다리는 질문입니다.`,
      createdFrom: "question" as const,
      status: "PRELIMINARY" as const,
    })),
  );
  await db.insert(thoughtQuestionQueueTable).values(
    thoughtIds.map((thoughtId, position) => ({
      userId,
      thoughtId,
      position,
    })),
  );

  return { userId, thoughtId: thoughtIds[0] };
}

async function runBarrierRace(
  baseUrl: string,
  userId: string,
  thoughtId: string,
  first: RequestKind,
) {
  const barrier = await pool.connect();
  let committed = false;
  try {
    await barrier.query("BEGIN");
    await barrier.query("SELECT pg_advisory_xact_lock(hashtext($1))", [
      `thought-question-queue:${userId}`,
    ]);

    const second = first === "patch" ? "activate" : "patch";
    const firstRequest = request(baseUrl, userId, thoughtId, first);
    await waitForQueueLockWaiters(userId, 1);
    const secondRequest = request(baseUrl, userId, thoughtId, second);
    await waitForQueueLockWaiters(userId, 2);

    // The first request entered PostgreSQL's wait queue first, so releasing the
    // barrier makes the requested operation order deterministic.
    await barrier.query("COMMIT");
    committed = true;
    const [firstResponse, secondResponse] = await Promise.all([
      firstRequest,
      secondRequest,
    ]);
    return { firstResponse, secondResponse };
  } finally {
    if (!committed) {
      await barrier.query("ROLLBACK").catch(() => undefined);
    }
    barrier.release();
  }
}

afterEach(async () => {
  const userIds = createdUserIds.splice(0);
  for (const userId of userIds) {
    await db
      .delete(thoughtQuestionQueueTable)
      .where(eq(thoughtQuestionQueueTable.userId, userId));
    await db.delete(thoughtsTable).where(eq(thoughtsTable.authorId, userId));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  }
});

describe.skipIf(!hasDatabase)(
  "question answer and activation PostgreSQL serialization",
  () => {
    let server: Server;
    let baseUrl: string;

    beforeAll(async () => {
      const started = await startServer();
      server = started.server;
      baseUrl = started.baseUrl;
    });

    afterAll(async () => {
      if (!server) return;
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    });

    it.each([
      ["PATCH acquires the queue lock first", "patch"],
      ["activate acquires the queue lock first", "activate"],
    ] as const)("%s", async (_description, first) => {
      const { userId, thoughtId } = await seedQuestionQueue();
      const { firstResponse, secondResponse } = await runBarrierRace(
        baseUrl,
        userId,
        thoughtId,
        first,
      );

      expect(firstResponse.status).toBe(200);
      expect(secondResponse.status).toBe(200);

      const patchRetry = await request(baseUrl, userId, thoughtId, "patch");
      const activateRetry = await request(
        baseUrl,
        userId,
        thoughtId,
        "activate",
      );
      expect(patchRetry.status).toBe(200);
      expect(activateRetry.status).toBe(200);
      expect(patchRetry.status).not.toBe(409);
      expect(activateRetry.status).not.toBe(409);
      expect(await patchRetry.json()).toMatchObject({
        id: thoughtId,
        content: ANSWER,
        status: "NORMAL",
      });
      expect(await activateRetry.json()).toMatchObject({
        activatedThought: {
          id: thoughtId,
          content: ANSWER,
          status: "NORMAL",
        },
      });

      const [thought] = await db
        .select({
          id: thoughtsTable.id,
          content: thoughtsTable.content,
          status: thoughtsTable.status,
        })
        .from(thoughtsTable)
        .where(
          and(
            eq(thoughtsTable.id, thoughtId),
            eq(thoughtsTable.authorId, userId),
          ),
        );
      const queue = await db
        .select({
          thoughtId: thoughtQuestionQueueTable.thoughtId,
          position: thoughtQuestionQueueTable.position,
        })
        .from(thoughtQuestionQueueTable)
        .where(eq(thoughtQuestionQueueTable.userId, userId))
        .orderBy(asc(thoughtQuestionQueueTable.position));

      expect(thought).toMatchObject({
        id: thoughtId,
        content: ANSWER,
        status: "NORMAL",
      });
      expect(queue).toHaveLength(2);
      expect(queue.map((row) => row.thoughtId)).not.toContain(thoughtId);
      expect(queue.map((row) => row.position)).toEqual([0, 1]);
    });
  },
);
