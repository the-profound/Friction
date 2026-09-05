import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

// GET /thoughts is the general archive list. Preliminary question-queue
// entries must never appear there — they are only reachable through the
// question-queue endpoints until activated. This guards the server-side
// filter regardless of what the client happens to render.
const state = vi.hoisted(() => {
  const column = (name: string) => ({ name });
  const tables = {
    thoughts: {
      id: column("thoughts.id"),
      authorId: column("thoughts.author_id"),
      content: column("thoughts.content"),
      createdFrom: column("thoughts.created_from"),
      sourceArticleId: column("thoughts.source_article_id"),
      sourceStoredSentenceId: column("thoughts.source_stored_sentence_id"),
      status: column("thoughts.status"),
      migratedFromArticleId: column("thoughts.migrated_from_article_id"),
      deletedAt: column("thoughts.deleted_at"),
      createdAt: column("thoughts.created_at"),
      updatedAt: column("thoughts.updated_at"),
    },
    promotions: {
      id: column("promotions.id"),
      fromThoughtId: column("promotions.from_thought_id"),
    },
  };

  const thoughtsById = new Map<string, Record<string, unknown>>();
  const promotedThoughtIds = new Set<string>();

  const db: any = {
    select: (_fields?: Record<string, unknown>) => {
      let table: unknown;
      const chain = {
        from(nextTable: unknown) {
          table = nextTable;
          return chain;
        },
        where() {
          return chain;
        },
        orderBy() {
          return chain;
        },
        then(
          onFulfilled: (value: unknown) => unknown,
          onRejected?: (reason: unknown) => unknown,
        ) {
          const resolved =
            table === tables.thoughts
              ? [...thoughtsById.values()]
                  .filter(
                    (row) =>
                      row.authorId === state.activeUser &&
                      row.deletedAt === null &&
                      !(
                        row.createdFrom === "question" &&
                        row.status === "PRELIMINARY" &&
                        row.sourceArticleId == null
                      ) &&
                      !promotedThoughtIds.has(row.id as string),
                  )
                  .sort(
                    (a, b) =>
                      (b.createdAt as Date).getTime() -
                      (a.createdAt as Date).getTime(),
                  )
              : [];
          return Promise.resolve(resolved).then(onFulfilled, onRejected);
        },
      };
      return chain;
    },
  };

  return { activeUser: "", thoughtsById, promotedThoughtIds, tables, db };
});

vi.mock("@workspace/db", () => ({
  db: state.db,
  articlesTable: state.tables.promotions,
  thoughtPromotionsTable: state.tables.promotions,
  thoughtQuestionQueueTable: state.tables.promotions,
  thoughtQuestionSourcesTable: state.tables.promotions,
  thoughtsTable: state.tables.thoughts,
}));

vi.mock("drizzle-orm/pg-core", async (importOriginal) => ({
  ...(await importOriginal<typeof import("drizzle-orm/pg-core")>()),
  alias: (table: unknown) => table,
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (
    req: { header: (name: string) => string | undefined; user?: { id: string } },
    _res: unknown,
    next: () => void,
  ) => {
    state.activeUser = req.header("x-test-user-id") ?? "";
    req.user = { id: state.activeUser };
    next();
  },
}));

vi.mock("../services/generate-preliminary-thought-question", () => ({
  generatePreliminaryThoughtQuestion: vi.fn(async () => null),
}));

vi.mock("../services/generate-random-preliminary-thought-question", () => ({
  generateRandomPreliminaryThoughtQuestion: vi.fn(() => ({
    title: "무작위 질문",
    description: "가볍게 떠올려 볼 질문입니다.",
  })),
}));

vi.mock("../services/preliminary-question-format", () => ({
  formatPreliminaryQuestionMarkdown: (title: string, description: string) =>
    `# ${title}\n\n${description}`,
  isQuestionThoughtMarkdown: () => false,
}));

const { default: router } = await import("./thoughts");

function thought(
  id: string,
  userId: string,
  overrides: Partial<Record<string, unknown>> = {},
) {
  return {
    id,
    authorId: userId,
    content: `# ${id}\n\n내용`,
    createdFrom: "direct",
    status: "NORMAL",
    sourceArticleId: null,
    sourceStoredSentenceId: null,
    migratedFromArticleId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    deletedAt: null,
    ...overrides,
  };
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

async function getThoughts(baseUrl: string, userId: string) {
  const response = await fetch(`${baseUrl}/thoughts`, {
    headers: { "x-test-user-id": userId },
  });
  return (await response.json()) as Array<{ id: string; status: string }>;
}

beforeEach(() => {
  state.activeUser = "";
  state.thoughtsById.clear();
  state.promotedThoughtIds.clear();
});

afterAll(() => vi.restoreAllMocks());

describe("GET /thoughts visibility", () => {
  it("returns preliminary direct and reading thoughts but hides only inactive queue entries", async () => {
    state.thoughtsById.set("normal-1", thought("normal-1", "user-a"));
    state.thoughtsById.set(
      "direct-preliminary",
      thought("direct-preliminary", "user-a", { status: "PRELIMINARY" }),
    );
    state.thoughtsById.set(
      "reading-preliminary",
      thought("reading-preliminary", "user-a", {
        status: "PRELIMINARY",
        createdFrom: "reading",
        sourceArticleId: "article-reading",
      }),
    );
    state.thoughtsById.set(
      "answered-question",
      thought("answered-question", "user-a", {
        status: "PRELIMINARY",
        createdFrom: "question",
        sourceArticleId: "article-question",
      }),
    );
    state.thoughtsById.set(
      "queued-1",
      thought("queued-1", "user-a", { status: "PRELIMINARY", createdFrom: "question" }),
    );

    await withServer(async (baseUrl) => {
      const body = await getThoughts(baseUrl, "user-a");
      expect(body.map((item) => item.id).sort()).toEqual([
        "answered-question",
        "direct-preliminary",
        "normal-1",
        "reading-preliminary",
      ]);
    });
  });

  it("still returns normal thoughts when none are queued questions", async () => {
    state.thoughtsById.set("normal-1", thought("normal-1", "user-a"));
    state.thoughtsById.set("normal-2", thought("normal-2", "user-a"));

    await withServer(async (baseUrl) => {
      const body = await getThoughts(baseUrl, "user-a");
      expect(body.map((item) => item.id).sort()).toEqual(["normal-1", "normal-2"]);
    });
  });

  it("keeps author, deletion, and promotion rules while a newly created direct thought survives refetch", async () => {
    state.thoughtsById.set(
      "a-direct-new",
      thought("a-direct-new", "user-a", { status: "PRELIMINARY" }),
    );
    state.thoughtsById.set(
      "a-queued",
      thought("a-queued", "user-a", { status: "PRELIMINARY", createdFrom: "question" }),
    );
    state.thoughtsById.set(
      "a-deleted",
      thought("a-deleted", "user-a", { deletedAt: new Date() }),
    );
    state.thoughtsById.set("a-promoted", thought("a-promoted", "user-a"));
    state.promotedThoughtIds.add("a-promoted");
    state.thoughtsById.set("b-normal", thought("b-normal", "user-b"));

    await withServer(async (baseUrl) => {
      const a = await getThoughts(baseUrl, "user-a");
      const aAfterRefetch = await getThoughts(baseUrl, "user-a");
      const b = await getThoughts(baseUrl, "user-b");
      expect(a.map((item) => item.id)).toEqual(["a-direct-new"]);
      expect(aAfterRefetch.map((item) => item.id)).toEqual(["a-direct-new"]);
      expect(b.map((item) => item.id)).toEqual(["b-normal"]);
    });
  });
});
