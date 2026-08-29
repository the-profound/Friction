import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

const state = vi.hoisted(() => {
  const column = (name: string) => ({ name });
  const tables = {
    readingRecords: {
      id: column("reading_records.id"),
      userId: column("reading_records.user_id"),
      articleId: column("reading_records.article_id"),
    },
    userArticleReads: {
      id: column("user_article_reads.id"),
      userId: column("user_article_reads.user_id"),
      articleId: column("user_article_reads.article_id"),
    },
  };
  const whereCalls: unknown[] = [];
  const insertCalls: Array<{ table: unknown; values: Record<string, unknown> }> = [];
  const responses: unknown[][] = [];
  const nextRows = () => responses.shift() ?? [];
  const db = {
    select: vi.fn(() => {
      const rows = nextRows();
      const chain = {
        from: () => chain,
        where: () => Promise.resolve(rows),
      };
      return chain;
    }),
    insert: vi.fn((table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        insertCalls.push({ table, values });
        return {
          onConflictDoUpdate: () => ({
            returning: async () => [{ id: "created", ...values }],
          }),
        };
      },
    })),
    delete: vi.fn(() => ({
      where: (condition: unknown) => {
        whereCalls.push(condition);
        return {
          returning: async () => nextRows(),
        };
      },
    })),
  };
  return { db, insertCalls, responses, tables, whereCalls };
});

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ op: "eq", left, right }),
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
}));

vi.mock("@workspace/db", () => ({
  db: state.db,
  readingRecordsTable: state.tables.readingRecords,
  userArticleReadsTable: state.tables.userArticleReads,
}));

vi.mock("@workspace/api-zod", () => ({
  UpsertReadingRecordBody: {
    safeParse: (body: unknown) => ({ success: true, data: body }),
  },
  CreateUserArticleReadBody: {
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

const { default: router } = await import("./reading");

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
  state.db.select.mockClear();
  state.db.insert.mockClear();
  state.db.delete.mockClear();
  state.insertCalls.length = 0;
  state.responses.length = 0;
  state.whereCalls.length = 0;
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("reading route authentication boundary", () => {
  it("requires authentication before reading saved progress", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(
        `${baseUrl}/reading-records?userId=user-a&articleId=article-1`,
      );
      expect(response.status).toBe(401);
      expect(state.db.select).not.toHaveBeenCalled();
    });
  });

  it("rejects a progress write for a different account", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/reading-records`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-test-user-id": "user-b",
        },
        body: JSON.stringify({
          userId: "user-a",
          articleId: "article-1",
          currentPage: 2,
          scrollPosition: 0,
        }),
      });
      expect(response.status).toBe(403);
      expect(state.db.insert).not.toHaveBeenCalled();
    });
  });

  it("allows progress writes only for the authenticated account", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/reading-records`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "x-test-user-id": "user-a",
        },
        body: JSON.stringify({
          userId: "user-a",
          articleId: "article-1",
          currentPage: 2,
          scrollPosition: 0,
        }),
      });
      expect(response.status).toBe(200);
      expect(state.insertCalls[0]?.values).toMatchObject({ userId: "user-a" });
    });
  });

  it("scopes record deletion to the authenticated owner", async () => {
    state.responses.push([]);
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/reading-records/record-a`, {
        method: "DELETE",
        headers: { "x-test-user-id": "user-b" },
      });
      expect(response.status).toBe(404);
      expect(state.whereCalls[0]).toEqual({
        op: "and",
        conditions: [
          {
            op: "eq",
            left: state.tables.readingRecords.id,
            right: "record-a",
          },
          {
            op: "eq",
            left: state.tables.readingRecords.userId,
            right: "user-b",
          },
        ],
      });
    });
  });
});