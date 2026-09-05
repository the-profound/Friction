import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

const state = vi.hoisted(() => {
  const column = (name: string) => ({ name });
  const tables = {
    storedSentences: {
      id: column("stored_sentences.id"),
      userId: column("stored_sentences.user_id"),
      articleId: column("stored_sentences.article_id"),
      text: column("stored_sentences.text"),
      sourceText: column("stored_sentences.source_text"),
      position: column("stored_sentences.position"),
      isFavorite: column("stored_sentences.is_favorite"),
      favoritedAt: column("stored_sentences.favorited_at"),
      createdAt: column("stored_sentences.created_at"),
    },
    articles: {
      id: column("articles.id"),
      title: column("articles.title"),
      authorId: column("articles.author_id"),
    },
    users: {
      id: column("users.id"),
      nickname: column("users.nickname"),
    },
    thoughtQuestionSources: {
      id: column("thought_question_sources.id"),
      sourceStoredSentenceId: column("thought_question_sources.source_stored_sentence_id"),
    },
    thoughts: {
      id: column("thoughts.id"),
      sourceStoredSentenceId: column("thoughts.source_stored_sentence_id"),
    },
  };
  const responses: unknown[][] = [];
  const whereCalls: unknown[] = [];
  const nextRows = () => responses.shift() ?? [];
  const makeSelectChain = (rows: unknown[]) => {
    const chain = {
      from: () => chain,
      leftJoin: () => chain,
      where: (condition: unknown) => {
        whereCalls.push(condition);
        return chain;
      },
      orderBy: async () => rows,
      limit: async () => rows,
      then: (
        resolve: (value: unknown[]) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  };
  const db = {
    select: vi.fn(() => makeSelectChain(nextRows())),
    insert: vi.fn(),
    delete: vi.fn(),
    update: vi.fn(() => ({
      set: () => ({
        where: (condition: unknown) => {
          whereCalls.push(condition);
          return { returning: async () => nextRows() };
        },
      }),
    })),
  };
  return { db, responses, tables, whereCalls };
});

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ op: "eq", left, right }),
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  desc: (column: unknown) => ({ op: "desc", column }),
  sql: () => ({ op: "sql" }),
}));

vi.mock("@workspace/db", () => ({
  db: state.db,
  storedSentencesTable: state.tables.storedSentences,
  articlesTable: state.tables.articles,
  usersTable: state.tables.users,
  thoughtQuestionSourcesTable: state.tables.thoughtQuestionSources,
  thoughtsTable: state.tables.thoughts,
}));

vi.mock("@workspace/api-zod", () => ({
  CreateStoredSentenceBody: {
    safeParse: (body: unknown) => ({ success: true, data: body }),
  },
  ToggleStoredSentenceFavoriteBody: {
    safeParse: (body: unknown) => ({ success: true, data: body }),
  },
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (
    req: { header: (name: string) => string | undefined; user?: { id: string } },
    res: { status: (status: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    const userId = req.header("x-test-user-id");
    if (!userId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.user = { id: userId };
    next();
  },
}));

const { default: router } = await import("./stored-sentences");

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

beforeEach(() => {
  vi.clearAllMocks();
  state.responses.length = 0;
  state.whereCalls.length = 0;
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("stored sentence authentication boundary", () => {
  it("requires authentication before listing stored sentences", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/stored-sentences?userId=user-a`);
      expect(response.status).toBe(401);
      expect(state.db.select).not.toHaveBeenCalled();
    });
  });

  it("rejects listing or creating sentences for another account", async () => {
    await withServer(async (baseUrl) => {
      const listResponse = await fetch(`${baseUrl}/stored-sentences?userId=user-a`, {
        headers: { "x-test-user-id": "user-b" },
      });
      expect(listResponse.status).toBe(403);

      const createResponse = await fetch(`${baseUrl}/stored-sentences`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-test-user-id": "user-b" },
        body: JSON.stringify({ userId: "user-a", text: "private sentence", sourceText: "private source" }),
      });
      expect(createResponse.status).toBe(403);
      expect(state.db.insert).not.toHaveBeenCalled();
    });
  });

  it("scopes detail, favorite, and delete lookups to the authenticated owner", async () => {
    await withServer(async (baseUrl) => {
      state.responses.push([], [], []);
      const headers = { "Content-Type": "application/json", "x-test-user-id": "user-b" };

      const detailResponse = await fetch(`${baseUrl}/stored-sentences/sentence-a`, { headers });
      expect(detailResponse.status).toBe(404);

      const favoriteResponse = await fetch(`${baseUrl}/stored-sentences/sentence-a/favorite`, {
        method: "PATCH",
        headers,
        body: JSON.stringify({ isFavorite: true }),
      });
      expect(favoriteResponse.status).toBe(404);

      const deleteResponse = await fetch(`${baseUrl}/stored-sentences/sentence-a`, {
        method: "DELETE",
        headers,
      });
      expect(deleteResponse.status).toBe(404);
      expect(state.db.delete).not.toHaveBeenCalled();

      const serializedConditions = JSON.stringify(state.whereCalls);
      expect(serializedConditions).toContain("stored_sentences.user_id");
      expect(serializedConditions).toContain("user-b");
    });
  });
});