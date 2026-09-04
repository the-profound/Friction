import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

const state = vi.hoisted(() => {
  const column = (name: string) => ({ name });
  const tables = {
    thoughts: {
      id: column("thoughts.id"),
      authorId: column("thoughts.author_id"),
      content: column("thoughts.content"),
      sourceArticleId: column("thoughts.source_article_id"),
      sourceStoredSentenceId: column("thoughts.source_stored_sentence_id"),
      migratedFromArticleId: column("thoughts.migrated_from_article_id"),
      status: column("thoughts.status"),
      createdFrom: column("thoughts.created_from"),
      deletedAt: column("thoughts.deleted_at"),
      updatedAt: column("thoughts.updated_at"),
    },
    queue: {
      id: column("queue.id"),
      userId: column("queue.user_id"),
      thoughtId: column("queue.thought_id"),
      position: column("queue.position"),
    },
    sources: {
      id: column("sources.id"),
      sourceThoughtId: column("sources.source_thought_id"),
      questionThoughtId: column("sources.question_thought_id"),
      sourceArticleId: column("sources.source_article_id"),
      sourceStoredSentenceId: column("sources.source_stored_sentence_id"),
    },
    promotions: { id: column("promotions.id"), fromThoughtId: column("promotions.from_thought_id") },
    articles: { id: column("articles.id") },
  };

  const queues = new Map<string, Array<{ id: string; thoughtId: string; position: number }>>();
  const thoughts = new Map<string, Record<string, unknown>>();
  const candidates = new Map<string, Array<Record<string, unknown>>>();
  const usedSources = new Map<string, Set<string>>();

  const rowsForUser = (userId: string) =>
    [...(queues.get(userId) ?? [])]
      .sort((left, right) => left.position - right.position)
      .flatMap((queue) => {
        const thought = thoughts.get(queue.thoughtId);
        return thought ? [{ queueId: queue.id, position: queue.position, thought }] : [];
      });

  const findStringParam = (condition: unknown): string | undefined => {
    if (typeof condition === "string") return condition;
    if (!condition || typeof condition !== "object") return undefined;
    const chunks = (condition as { queryChunks?: unknown[] }).queryChunks;
    if (!chunks) return undefined;
    for (const chunk of chunks) {
      const value = findStringParam(chunk);
      if (value) return value;
    }
    return undefined;
  };
  const collectStringParams = (condition: unknown): string[] => {
    if (typeof condition === "string") return [condition];
    if (!condition || typeof condition !== "object") return [];
    return ((condition as { queryChunks?: unknown[] }).queryChunks ?? [])
      .flatMap(collectStringParams);
  };

  const db: any = {
    transaction: async (callback: (tx: any) => unknown) => callback(db),
    execute: vi.fn(async () => []),
    select: (fields?: Record<string, unknown>) => {
      let table: unknown;
      const resolve = () => {
        if (table === tables.queue) {
          if (fields && "queueId" in fields) return rowsForUser(state.activeUser);
          const selectedThought = state.selectedThoughtId;
          return (queues.get(state.activeUser) ?? [])
            .filter((queue) => queue.thoughtId === selectedThought)
            .map((queue) => ({ id: queue.id }));
        }
        if (table === tables.thoughts) {
          if (fields && "authorId" in fields && state.selectedThoughtId) {
            const selected = thoughts.get(state.selectedThoughtId);
            return selected ? [{
              id: selected.id,
              authorId: selected.authorId,
              migratedFromArticleId: selected.migratedFromArticleId ?? null,
            }] : [];
          }
          if (!fields) {
            const thought = state.selectedThoughtId ? thoughts.get(state.selectedThoughtId) : undefined;
            return thought ? [thought] : [];
          }
          const used = usedSources.get(state.activeUser) ?? new Set<string>();
          return (candidates.get(state.activeUser) ?? []).filter(
            (candidate) => candidate.createdFrom !== "question" && !used.has(String(candidate.id)),
          );
        }
        if (table === tables.sources) {
          return [...(usedSources.get(state.activeUser) ?? [])].map((sourceThoughtId) => ({ sourceThoughtId }));
        }
        return [];
      };
      const chain = {
        from(nextTable: unknown) {
          table = nextTable;
          return chain;
        },
        innerJoin() {
          return chain;
        },
        where() {
          return chain;
        },
        orderBy() {
          return chain;
        },
        limit(value?: number) {
          if (table === tables.thoughts && typeof value === "number") {
            state.lastCandidateLimit = value;
          }
          return Promise.resolve(resolve());
        },
        for() {
          return Promise.resolve(resolve());
        },
        then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
          return Promise.resolve(resolve()).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown> | Array<Record<string, unknown>>) => ({
        returning: () => {
          const value = Array.isArray(values) ? values[0]! : values;
          if (table === tables.thoughts) {
            const id = `generated-${++state.generatedCount}`;
            const thought = {
              id,
              authorId: state.activeUser,
              content: value.content,
              createdFrom: "question",
              status: "PRELIMINARY",
              createdAt: new Date(),
              updatedAt: new Date(),
              deletedAt: null,
              sourceArticleId: null,
              sourceStoredSentenceId: null,
            };
            thoughts.set(id, thought);
            return Promise.resolve([thought]);
          }
          if (table === tables.queue) {
            const queue = {
              id: `queue-${state.activeUser}-${++state.queueCount}`,
              thoughtId: String(value.thoughtId),
              position: Number(value.position),
            };
            const userQueue = queues.get(state.activeUser) ?? [];
            userQueue.push(queue);
            queues.set(state.activeUser, userQueue);
            return Promise.resolve([{ id: queue.id, position: queue.position }]);
          }
          if (table === tables.sources) {
            const sourceSet = usedSources.get(state.activeUser) ?? new Set<string>();
            for (const source of Array.isArray(values) ? values : [values]) {
              if (typeof source.sourceThoughtId === "string") sourceSet.add(source.sourceThoughtId);
            }
            usedSources.set(state.activeUser, sourceSet);
          }
          return Promise.resolve([]);
        },
      }),
    }),
    update: (table: unknown) => ({
      set: (values: Record<string, unknown>) => ({
        where: (condition: unknown) => ({
          apply: () => {
            if (table === tables.queue) {
              const queue = rowsForUser(state.activeUser)[0];
              if (queue) {
                const entry = (queues.get(state.activeUser) ?? []).find((item) => item.id === queue.queueId);
                if (entry) entry.position = Number(values.position);
              }
              return [];
            }
            const thoughtId = findStringParam(condition) ?? state.selectedThoughtId;
            const thought = thoughtId ? thoughts.get(thoughtId) : undefined;
            if (!thought) return [];
            Object.assign(thought, values);
            return [thought];
          },
          returning() {
            return Promise.resolve(this.apply());
          },
          then(onFulfilled: (value: unknown) => unknown, onRejected?: (reason: unknown) => unknown) {
            return Promise.resolve(this.apply()).then(onFulfilled, onRejected);
          },
        }),
      }),
    }),
    delete: (table: unknown) => ({
      where: (condition: unknown) => {
        if (table === tables.queue) {
          const userQueue = queues.get(state.activeUser) ?? [];
          const params = collectStringParams(condition);
          const queueId = userQueue.find((queue) => params.includes(queue.id))?.id;
          queues.set(
            state.activeUser,
            userQueue.filter((queue) =>
              queueId
                ? queue.id !== queueId
                : queue.thoughtId !== state.selectedThoughtId),
          );
        }
        return Promise.resolve([]);
      },
    }),
  };

  return {
    activeUser: "",
    selectedThoughtId: "",
    generatedCount: 0,
    queueCount: 0,
    lastCandidateLimit: 0,
    queues,
    thoughts,
    candidates,
    usedSources,
    tables,
    db,
    rowsForUser,
  };
});

vi.mock("@workspace/db", () => ({
  db: state.db,
  articlesTable: state.tables.articles,
  thoughtPromotionsTable: state.tables.promotions,
  thoughtQuestionQueueTable: state.tables.queue,
  thoughtQuestionSourcesTable: state.tables.sources,
  thoughtsTable: state.tables.thoughts,
}));

vi.mock("drizzle-orm/pg-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm/pg-core")>()),
  alias: (table: unknown) => table,
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: { header: (name: string) => string | undefined; user?: { id: string } }, _res: unknown, next: () => void) => {
    state.activeUser = req.header("x-test-user-id") ?? "";
    state.selectedThoughtId = req.header("x-test-selected-thought-id") ?? "";
    req.user = { id: state.activeUser };
    next();
  },
}));

vi.mock("../services/generate-preliminary-thought-question", () => ({
  generatePreliminaryThoughtQuestion: vi.fn(async () => ({
    title: "생성된 질문",
    description: "기록을 이어갈 질문입니다.",
  })),
}));

vi.mock("../services/generate-random-preliminary-thought-question", () => ({
  generateRandomPreliminaryThoughtQuestion: vi.fn(() => ({
    title: `무작위 질문 ${state.generatedCount + 1}`,
    description: "가볍게 떠올려 볼 질문입니다.",
  })),
}));

vi.mock("../services/preliminary-question-format", () => ({
  formatPreliminaryQuestionMarkdown: (title: string, description: string) => `# ${title}\n\n${description}`,
  isQuestionThoughtMarkdown: () => false,
}));

const { default: router } = await import("./thoughts");
const { generatePreliminaryThoughtQuestion } = await import(
  "../services/generate-preliminary-thought-question"
);

type QueueResponse = {
  current: { id: string } | null;
  next: { id: string } | null;
  queue: Array<{ id: string }>;
  requeued?: boolean;
  activatedThought?: { id: string; status: string };
};

function thought(id: string, userId: string, status: "NORMAL" | "PRELIMINARY" = "PRELIMINARY") {
  return {
    id,
    authorId: userId,
    content: `# ${id}\n\n내용`,
    createdFrom: status === "PRELIMINARY" ? "question" : "direct",
    status,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    sourceArticleId: null,
    sourceStoredSentenceId: null,
  };
}

function seedQueue(userId: string, ids: string[]) {
  const entries = ids.map((id, position) => {
    const item = thought(id, userId);
    state.thoughts.set(id, item);
    return { id: `queue-${userId}-${id}`, thoughtId: id, position };
  });
  state.queues.set(userId, entries);
}

function seedCandidates(userId: string, count: number) {
  state.candidates.set(
    userId,
    Array.from({ length: count }, (_, index) => ({
      id: `${userId}-source-${index + 1}`,
      content: `충분한 기록 ${index + 1}`,
      sourceArticleId: null,
      sourceStoredSentenceId: null,
      createdFrom: "direct",
    })),
  );
}

function seedRecentGeneratedQuestionCandidates(userId: string, count: number) {
  const existing = state.candidates.get(userId) ?? [];
  const recentQuestions = Array.from({ length: count }, (_, index) => ({
    id: `${userId}-recent-question-${index + 1}`,
    content: `# 생성 질문 ${index + 1}\n\n이전 질문입니다.`,
    sourceArticleId: null,
    sourceStoredSentenceId: null,
    createdFrom: "question",
  }));
  state.candidates.set(userId, [...recentQuestions, ...existing]);
}

async function withServer(test: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(express.json());
  app.use("/api", router);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });
  try {
    const address = server.address() as AddressInfo;
    await test(`http://127.0.0.1:${address.port}/api`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

async function request(baseUrl: string, userId: string, path: string, init?: RequestInit) {
  const selectedThoughtId =
    /^\/thoughts\/([^/]+)\/activate$/.exec(path)?.[1]
    ?? (init?.method === "DELETE" ? /^\/thoughts\/([^/]+)$/.exec(path)?.[1] : undefined);
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "x-test-user-id": userId,
      "x-test-selected-thought-id": selectedThoughtId ?? "",
      "content-type": "application/json",
      ...init?.headers,
    },
  });
}

beforeEach(() => {
  state.activeUser = "";
  state.selectedThoughtId = "";
  state.generatedCount = 0;
  state.queueCount = 0;
  state.lastCandidateLimit = 0;
  state.queues.clear();
  state.thoughts.clear();
  state.candidates.clear();
  state.usedSources.clear();
  state.db.execute.mockClear();
});

afterAll(() => vi.restoreAllMocks());

describe("thought question queue API", () => {
  it("fills the minimum backlog with random questions when no source material exists", async () => {
    await withServer(async (baseUrl) => {
      const body = (await (await request(baseUrl, "user-a", "/thoughts/question-queue")).json()) as QueueResponse;
      expect(body.queue).toHaveLength(3);
      expect(body.queue.map((item: { id: string }) => item.id)).toEqual([
        "generated-1",
        "generated-2",
        "generated-3",
      ]);
      expect(body.current).toMatchObject({ id: "generated-1" });
      expect(body.next).toMatchObject({ id: "generated-2" });
      expect(state.generatedCount).toBe(3);
    });
  });

  it("falls back to the minimum backlog when AI generation fails", async () => {
    seedCandidates("user-a", 3);
    vi.mocked(generatePreliminaryThoughtQuestion).mockRejectedValueOnce(new Error("AI unavailable"));

    await withServer(async (baseUrl) => {
      const response = await request(baseUrl, "user-a", "/thoughts/question-queue");
      expect(response.status).toBe(200);
      const body = (await response.json()) as QueueResponse;
      expect(body.queue).toHaveLength(3);
      expect(body.current).toMatchObject({ id: "generated-1" });
      expect(body.next).toMatchObject({ id: "generated-2" });
    });
  });

  it("falls back to the minimum backlog when AI rejects low-signal source material", async () => {
    seedCandidates("user-a", 3);
    vi.mocked(generatePreliminaryThoughtQuestion).mockResolvedValueOnce(null);

    await withServer(async (baseUrl) => {
      const body = (await (await request(baseUrl, "user-a", "/thoughts/question-queue")).json()) as QueueResponse;
      expect(body.queue).toHaveLength(3);
      expect(body.queue.map((item) => item.id)).toEqual([
        "generated-1",
        "generated-2",
        "generated-3",
      ]);
    });
  });

  it("adds only enough random questions to reach the minimum backlog", async () => {
    seedQueue("user-a", ["existing-a", "existing-b"]);

    await withServer(async (baseUrl) => {
      const body = (await (await request(baseUrl, "user-a", "/thoughts/question-queue")).json()) as QueueResponse;
      expect(body.queue.map((item: { id: string }) => item.id)).toEqual([
        "existing-a",
        "existing-b",
        "generated-1",
      ]);
      expect(state.generatedCount).toBe(1);
    });
  });

  it("never adds questions beyond the six-card maximum", async () => {
    seedQueue("user-a", [
      "existing-1",
      "existing-2",
      "existing-3",
      "existing-4",
      "existing-5",
      "existing-6",
    ]);
    seedCandidates("user-a", 18);

    await withServer(async (baseUrl) => {
      const body = (await (await request(baseUrl, "user-a", "/thoughts/question-queue")).json()) as QueueResponse;
      expect(body.queue).toHaveLength(6);
      expect(state.generatedCount).toBe(0);
    });
  });

  it("trims an oversized persisted queue to the first six FIFO questions", async () => {
    seedQueue("user-a", [
      "existing-1",
      "existing-2",
      "existing-3",
      "existing-4",
      "existing-5",
      "existing-6",
      "existing-7",
    ]);

    await withServer(async (baseUrl) => {
      const body = (await (await request(baseUrl, "user-a", "/thoughts/question-queue")).json()) as QueueResponse;
      expect(body.queue.map((item: { id: string }) => item.id)).toEqual([
        "existing-1",
        "existing-2",
        "existing-3",
        "existing-4",
        "existing-5",
        "existing-6",
      ]);
      expect(state.queues.get("user-a")).toHaveLength(6);
      expect(state.thoughts.get("existing-7")?.deletedAt).toBeInstanceOf(Date);
    });
  });

  it("keeps only six questions when refreshing an oversized queue", async () => {
    seedQueue("user-a", [
      "question-1",
      "question-2",
      "question-3",
      "question-4",
      "question-5",
      "question-6",
      "question-7",
    ]);

    await withServer(async (baseUrl) => {
      const response = await request(baseUrl, "user-a", "/thoughts/question-queue/refresh", {
        method: "POST",
        body: JSON.stringify({ currentThoughtId: "question-1" }),
      });
      const body = (await response.json()) as QueueResponse;
      expect(body.queue.map((item: { id: string }) => item.id)).toEqual([
        "question-2",
        "question-3",
        "question-4",
        "question-5",
        "question-6",
        "question-1",
      ]);
      expect(state.queues.get("user-a")).toHaveLength(6);
      expect(state.thoughts.get("question-7")?.deletedAt).toBeInstanceOf(Date);
    });
  });

  it("normalizes an oversized queue before returning a stale refresh snapshot", async () => {
    seedQueue("user-a", [
      "question-1",
      "question-2",
      "question-3",
      "question-4",
      "question-5",
      "question-6",
      "question-7",
    ]);

    await withServer(async (baseUrl) => {
      const response = await request(baseUrl, "user-a", "/thoughts/question-queue/refresh", {
        method: "POST",
        body: JSON.stringify({ currentThoughtId: "question-2" }),
      });
      expect(await response.json()).toMatchObject({
        requeued: false,
        queue: [
          { id: "question-1" },
          { id: "question-2" },
          { id: "question-3" },
          { id: "question-4" },
          { id: "question-5" },
          { id: "question-6" },
        ],
      });
      expect(state.queues.get("user-a")).toHaveLength(6);
    });
  });

  it("keeps only six questions after activating one from an oversized queue", async () => {
    seedQueue("user-a", [
      "question-1",
      "question-2",
      "question-3",
      "question-4",
      "question-5",
      "question-6",
      "question-7",
      "question-8",
    ]);

    await withServer(async (baseUrl) => {
      const response = await request(baseUrl, "user-a", "/thoughts/question-2/activate", {
        method: "POST",
      });
      const body = (await response.json()) as QueueResponse;
      expect(body.queue.map((item: { id: string }) => item.id)).toEqual([
        "question-1",
        "question-3",
        "question-4",
        "question-5",
        "question-6",
      ]);
      expect(state.queues.get("user-a")).toHaveLength(5);
      expect(state.thoughts.get("question-7")?.deletedAt).toBeInstanceOf(Date);
      expect(state.thoughts.get("question-8")?.deletedAt).toBeInstanceOf(Date);
    });
  });

  it("returns a bounded, ordered full queue while retaining current and next aliases", async () => {
    seedCandidates("user-a", 18);

    await withServer(async (baseUrl) => {
      const response = await request(baseUrl, "user-a", "/thoughts/question-queue");
      expect(response.status).toBe(200);
      const body = (await response.json()) as QueueResponse;

      expect(body.queue).toHaveLength(6);
      expect(body.queue.map((item: { id: string }) => item.id)).toEqual([
        "generated-1",
        "generated-2",
        "generated-3",
        "generated-4",
        "generated-5",
        "generated-6",
      ]);
      expect(body.current).toMatchObject({ id: "generated-1" });
      expect(body.next).toMatchObject({ id: "generated-2" });
      expect(state.generatedCount).toBe(6);
      expect(state.lastCandidateLimit).toBe(18);
    });
  });

  it("preserves existing order when source material cannot fill the bounded backlog", async () => {
    seedQueue("user-a", ["existing-a", "existing-b"]);
    seedCandidates("user-a", 2);

    await withServer(async (baseUrl) => {
      const body = (await (await request(baseUrl, "user-a", "/thoughts/question-queue")).json()) as QueueResponse;
      expect(body.queue.map((item: { id: string }) => item.id)).toEqual([
        "existing-a",
        "existing-b",
        "generated-1",
      ]);
      expect(body.current).not.toBeNull();
      expect(body.next).not.toBeNull();
      if (!body.current || !body.next) throw new Error("Expected compatible current and next queue aliases");
      expect(body.current.id).toBe("existing-a");
      expect(body.next.id).toBe("existing-b");
    });
  });

  it("refills from an older unused source after the recent source window is exhausted", async () => {
    seedQueue("user-a", ["existing-1", "existing-2", "existing-3", "existing-4", "existing-5"]);
    seedCandidates("user-a", 19);
    state.usedSources.set(
      "user-a",
      new Set(Array.from({ length: 18 }, (_, index) => `user-a-source-${index + 1}`)),
    );

    await withServer(async (baseUrl) => {
      const body = (await (await request(baseUrl, "user-a", "/thoughts/question-queue")).json()) as QueueResponse;
      expect(body.queue).toHaveLength(6);
      expect(body.queue.at(-1)).toMatchObject({ id: "generated-1" });
      expect(state.generatedCount).toBe(1);
    });
  });

  it("skips recently activated generated questions to refill from older direct thoughts", async () => {
    seedQueue("user-a", ["existing-1", "existing-2", "existing-3", "existing-4", "existing-5"]);
    seedCandidates("user-a", 3);
    seedRecentGeneratedQuestionCandidates("user-a", 18);

    await withServer(async (baseUrl) => {
      const body = (await (await request(baseUrl, "user-a", "/thoughts/question-queue")).json()) as QueueResponse;
      expect(body.queue).toHaveLength(6);
      expect(body.queue.at(-1)).toMatchObject({ id: "generated-1" });
      expect(state.generatedCount).toBe(1);
    });
  });

  it("requeues the current question once and treats a retry as a non-mutating snapshot", async () => {
    seedQueue("user-a", ["question-a", "question-b", "question-c"]);

    await withServer(async (baseUrl) => {
      const first = await request(baseUrl, "user-a", "/thoughts/question-queue/refresh", {
        method: "POST",
        body: JSON.stringify({ currentThoughtId: "question-a" }),
      });
      expect(first.status).toBe(200);
      expect(await first.json()).toMatchObject({
        requeued: true,
        current: { id: "question-b" },
        next: { id: "question-c" },
        queue: [{ id: "question-b" }, { id: "question-c" }, { id: "question-a" }],
      });

      // A retry may arrive after generation becomes available. It must not
      // refill or mutate the snapshot after the original refresh succeeded.
      seedCandidates("user-a", 3);
      const retry = await request(baseUrl, "user-a", "/thoughts/question-queue/refresh", {
        method: "POST",
        body: JSON.stringify({ currentThoughtId: "question-a" }),
      });
      expect(await retry.json()).toMatchObject({
        requeued: false,
        queue: [{ id: "question-b" }, { id: "question-c" }, { id: "question-a" }],
      });
      expect(state.generatedCount).toBe(0);
    });
  });

  it("activates only the selected question and returns the same queue snapshot for a retry", async () => {
    seedQueue("user-a", ["question-a", "question-b", "question-c"]);
    state.usedSources.set("user-a", new Set(["source-preserved"]));

    await withServer(async (baseUrl) => {
      const activated = await request(baseUrl, "user-a", "/thoughts/question-b/activate", { method: "POST" });
      expect(activated.status).toBe(200);
      expect(await activated.json()).toMatchObject({
        activatedThought: { id: "question-b", status: "NORMAL" },
        queue: [{ id: "question-a" }, { id: "question-c" }, { id: "generated-1" }],
      });
      expect(state.usedSources.get("user-a")).toEqual(new Set(["source-preserved"]));
      expect(state.generatedCount).toBe(1);

      // The successful activation owns the single refill attempt. A network
      // retry must not create a question that was unavailable at that time.
      seedCandidates("user-a", 3);
      const retry = await request(baseUrl, "user-a", "/thoughts/question-b/activate", { method: "POST" });
      expect(retry.status).toBe(200);
      expect(await retry.json()).toMatchObject({
        activatedThought: { id: "question-b", status: "NORMAL" },
        queue: [{ id: "question-a" }, { id: "question-c" }, { id: "generated-1" }],
      });
      expect(state.generatedCount).toBe(1);
    });
  });

  it("deletes only the selected queued question and serializes the queue mutation", async () => {
    seedQueue("user-a", ["question-a", "question-b", "question-c"]);

    await withServer(async (baseUrl) => {
      const response = await request(baseUrl, "user-a", "/thoughts/question-b", {
        method: "DELETE",
      });

      expect(response.status).toBe(204);
      expect(state.rowsForUser("user-a").map((entry) => entry.thought.id)).toEqual([
        "question-a",
        "question-c",
      ]);
      expect(state.thoughts.get("question-b")?.deletedAt).toBeInstanceOf(Date);
      expect(state.db.execute).toHaveBeenCalledWith(
        expect.objectContaining({ queryChunks: expect.any(Array) }),
      );
    });
  });

  it("never exposes another user's queued questions", async () => {
    seedQueue("user-a", ["question-a"]);
    seedQueue("user-b", ["question-b"]);

    await withServer(async (baseUrl) => {
      const a = (await (await request(baseUrl, "user-a", "/thoughts/question-queue")).json()) as QueueResponse;
      const b = (await (await request(baseUrl, "user-b", "/thoughts/question-queue")).json()) as QueueResponse;
      expect(a.queue).toHaveLength(3);
      expect(b.queue).toHaveLength(3);
      expect(a.queue[0]).toMatchObject({ id: "question-a" });
      expect(b.queue[0]).toMatchObject({ id: "question-b" });
      expect(a.queue).not.toContainEqual(expect.objectContaining({ id: "question-b" }));
      expect(b.queue).not.toContainEqual(expect.objectContaining({ id: "question-a" }));
    });
  });
});