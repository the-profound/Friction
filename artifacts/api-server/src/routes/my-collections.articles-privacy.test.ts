import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";

// Covers the privacy-critical parts of GET /my-collections/:id/articles:
// auth/ownership gating, never leaking a masked author's real ID, and using
// an "any matching Space is anonymous" rule (not just the earliest row) so a
// multi-space article can't slip a real nickname through a non-anonymous match.

const state = vi.hoisted(() => {
  const column = (name: string) => ({ name });
  const tables = {
    myCollections: {
      id: column("my_collections.id"),
      ownerId: column("my_collections.owner_id"),
    },
    myCollectionArticles: {
      id: column("my_collection_articles.id"),
      myCollectionId: column("my_collection_articles.my_collection_id"),
      articleId: column("my_collection_articles.article_id"),
      addedAt: column("my_collection_articles.added_at"),
    },
    articles: {
      id: column("articles.id"),
      authorId: column("articles.author_id"),
    },
    users: {
      id: column("users.id"),
      nickname: column("users.nickname"),
    },
  };
  const responses: unknown[][] = [];
  const nextRows = () => responses.shift() ?? [];
  const sqlCalls: { strings: readonly string[] }[] = [];
  const makeSelectChain = (rows: unknown[]) => {
    const chain = {
      from: () => chain,
      leftJoin: () => chain,
      groupBy: () => chain,
      where: () => chain,
      then: (
        resolve: (value: unknown[]) => unknown,
        reject?: (reason: unknown) => unknown,
      ) => Promise.resolve(rows).then(resolve, reject),
    };
    return chain;
  };
  const db = {
    select: vi.fn(() => makeSelectChain(nextRows())),
  };
  return { db, responses, tables, sqlCalls };
});

vi.mock("drizzle-orm", () => ({
  eq: (left: unknown, right: unknown) => ({ op: "eq", left, right }),
  and: (...conditions: unknown[]) => ({ op: "and", conditions }),
  count: () => ({ op: "count" }),
  sql: Object.assign(
    (strings: TemplateStringsArray, ...values: unknown[]) => {
      state.sqlCalls.push({ strings: Array.from(strings) });
      return { op: "sql", text: strings.join("?"), values };
    },
    { raw: (text: string) => ({ op: "sql.raw", text }) },
  ),
}));

vi.mock("@workspace/db", () => ({
  db: state.db,
  myCollectionsTable: state.tables.myCollections,
  myCollectionArticlesTable: state.tables.myCollectionArticles,
  articlesTable: state.tables.articles,
  usersTable: state.tables.users,
}));

vi.mock("@workspace/api-zod", () => ({
  CreateMyCollectionBody: { safeParse: (body: unknown) => ({ success: true, data: body }) },
  UpdateMyCollectionBody: { safeParse: (body: unknown) => ({ success: true, data: body }) },
  AddArticleToMyCollectionBody: { safeParse: (body: unknown) => ({ success: true, data: body }) },
}));

vi.mock("../lib/impressionCollection", () => ({
  ensureImpressionCollection: vi.fn(async () => {}),
  IMPRESSION_COLLECTION_NAME: "인상깊은 편지",
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (
    req: { header: (name: string) => string | undefined; user?: { id: string } },
    res: { status: (status: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    const userId = req.header("x-test-user-id");
    if (!userId) {
      res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
      return;
    }
    req.user = { id: userId };
    next();
  },
}));

const { default: router } = await import("./my-collections");
// The subquery `sql` tags are module-level consts, evaluated once at import
// time above — snapshot them now since beforeEach() clears state.sqlCalls
// for the per-request assertions in the other tests.
const moduleLoadSqlCalls = [...state.sqlCalls];

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
  state.sqlCalls.length = 0;
});

afterAll(() => {
  vi.restoreAllMocks();
});

describe("GET /my-collections/:id/articles access control", () => {
  it("requires authentication", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/my-collections/collection-a/articles`);
      expect(response.status).toBe(401);
      expect(state.db.select).not.toHaveBeenCalled();
    });
  });

  it("returns 404 when the collection does not exist", async () => {
    await withServer(async (baseUrl) => {
      state.responses.push([]); // collection lookup: no row
      const response = await fetch(`${baseUrl}/my-collections/collection-a/articles`, {
        headers: { "x-test-user-id": "owner-1" },
      });
      expect(response.status).toBe(404);
    });
  });

  it("rejects a caller who does not own the collection", async () => {
    await withServer(async (baseUrl) => {
      state.responses.push([{ ownerId: "owner-1" }]); // collection lookup
      const response = await fetch(`${baseUrl}/my-collections/collection-a/articles`, {
        headers: { "x-test-user-id": "someone-else" },
      });
      expect(response.status).toBe(403);
      // Only the ownership-check select ran; the row-fetching select must never happen.
      expect(state.db.select).toHaveBeenCalledTimes(1);
    });
  });
});

describe("GET /my-collections/:id/articles identity masking", () => {
  it("never returns the real authorId or nickname for a masked (anonymous-space, foreign-authored) letter", async () => {
    await withServer(async (baseUrl) => {
      state.responses.push([{ ownerId: "owner-1" }]); // collection lookup
      state.responses.push([
        {
          id: "entry-1",
          myCollectionId: "collection-a",
          articleId: "article-1",
          addedAt: "2026-01-01T00:00:00.000Z",
          article: { id: "article-1", authorId: "real-author-id", title: "t", content: "c" },
          authorNickname: "실명닉네임",
          collectionName: null,
          collectionId: null,
          spaceName: "익명 공간",
          spaceIsAnonymous: true,
          spaceAuthorSpaceNickname: "공간닉네임",
        },
      ]);

      const response = await fetch(`${baseUrl}/my-collections/collection-a/articles`, {
        headers: { "x-test-user-id": "owner-1" },
      });
      expect(response.status).toBe(200);
      const body = await response.json() as Array<{ article: Record<string, unknown> | null }>;
      const article = body[0]?.article;
      expect(article).toBeTruthy();
      expect(article?.authorIdentityMasked).toBe(true);
      expect(article?.authorNickname).toBe("공간닉네임");
      // The whole point of masking: the client must never receive the real ID
      // alongside the safe nickname, or it can resolve identity itself.
      expect(article?.authorId).toBeNull();
      expect(JSON.stringify(body)).not.toContain("real-author-id");
      expect(JSON.stringify(body)).not.toContain("실명닉네임");
    });
  });

  it("keeps the real authorId and nickname for a self-authored letter even from an anonymous space", async () => {
    await withServer(async (baseUrl) => {
      state.responses.push([{ ownerId: "owner-1" }]);
      state.responses.push([
        {
          id: "entry-2",
          myCollectionId: "collection-a",
          articleId: "article-2",
          addedAt: "2026-01-01T00:00:00.000Z",
          article: { id: "article-2", authorId: "owner-1", title: "t", content: "c" },
          authorNickname: "owner nickname",
          collectionName: null,
          collectionId: null,
          spaceName: "익명 공간",
          spaceIsAnonymous: true,
          spaceAuthorSpaceNickname: "공간닉네임",
        },
      ]);

      const response = await fetch(`${baseUrl}/my-collections/collection-a/articles`, {
        headers: { "x-test-user-id": "owner-1" },
      });
      const body = await response.json() as Array<{ article: Record<string, unknown> | null }>;
      const article = body[0]?.article;
      expect(article?.authorIdentityMasked).toBe(false);
      expect(article?.authorId).toBe("owner-1");
      expect(article?.authorNickname).toBe("owner nickname");
    });
  });

  it("returns spaceId alongside spaceName for a foreign-authored letter, so the overlay's Space link is active", async () => {
    // Regression guard: the client can only build a working "navigate to
    // Space" link when it receives a real spaceId paired with spaceName —
    // this endpoint previously omitted spaceId from the response entirely.
    await withServer(async (baseUrl) => {
      state.responses.push([{ ownerId: "owner-1" }]);
      state.responses.push([
        {
          id: "entry-3",
          myCollectionId: "collection-a",
          articleId: "article-3",
          addedAt: "2026-01-01T00:00:00.000Z",
          article: { id: "article-3", authorId: "other-author-id", title: "t", content: "c" },
          authorNickname: "실명닉네임",
          collectionName: null,
          collectionId: null,
          spaceName: "가을 편지 모임",
          spaceId: "space-autumn",
          spaceIsAnonymous: false,
          spaceAuthorSpaceNickname: null,
        },
      ]);

      const response = await fetch(`${baseUrl}/my-collections/collection-a/articles`, {
        headers: { "x-test-user-id": "owner-1" },
      });
      const body = await response.json() as Array<{ article: Record<string, unknown> | null }>;
      const article = body[0]?.article;
      expect(article?.spaceName).toBe("가을 편지 모임");
      expect(article?.spaceId).toBe("space-autumn");
    });
  });

  it("resolves spaceName and spaceId from the exact same space_letters row (same FROM/JOIN/WHERE/ORDER BY/LIMIT shape)", () => {
    // We can't run the real correlated subqueries against a mocked db, so we
    // assert the two module-level `sql` tags are structurally identical
    // apart from selecting s.name vs s.id — this is what guarantees they
    // always describe the same Space for a multi-space article.
    const nameQuery = moduleLoadSqlCalls.find((call) =>
      call.strings.some((part) => part.includes("SELECT s.name") && part.includes("space_letters")),
    );
    const idQuery = moduleLoadSqlCalls.find((call) =>
      call.strings.some((part) => part.includes("SELECT s.id") && part.includes("space_letters")),
    );
    expect(nameQuery).toBeTruthy();
    expect(idQuery).toBeTruthy();
    const normalize = (call: { strings: readonly string[] }) =>
      call.strings.join("").replace(/SELECT s\.(name|id)/, "SELECT s.<col>");
    expect(normalize(nameQuery!)).toBe(normalize(idQuery!));
  });

  it("builds the anonymity check as an OR across every matching space_letters row, not just the earliest", async () => {
    // Regression guard for the earliest-row bug: a non-anonymous first
    // submission must not hide a later anonymous one. We can't run the real
    // SQL against a mocked db, so we assert the query text itself uses an
    // aggregate (bool_or) over all matches instead of `ORDER BY ... LIMIT 1`.
    const anonymityQuery = moduleLoadSqlCalls.find((call) =>
      call.strings.some((part) => part.includes("bool_or") && part.includes("is_anonymous")),
    );
    expect(anonymityQuery).toBeTruthy();
    const fullText = anonymityQuery!.strings.join("");
    expect(fullText).not.toMatch(/bool_or[\s\S]*ORDER BY[\s\S]*LIMIT 1/);
  });
});
