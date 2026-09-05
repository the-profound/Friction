import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { readFileSync } from "node:fs";
import express from "express";

type Space = {
  id: string;
  inviteCode: string | null;
  isAnonymous: boolean;
  status: "RECRUITING" | "ACTIVE" | "ARCHIVED";
  maxParticipants: number | null;
};

const state = vi.hoisted(() => {
  const column = (name: string) => ({ name });
  const tables = {
    spaces: {
      id: column("spaces.id"),
      inviteCode: column("spaces.invite_code"),
      status: column("spaces.status"),
    },
    participations: {
      id: column("space_participations.id"),
      spaceId: column("space_participations.space_id"),
      userId: column("space_participations.user_id"),
      role: column("space_participations.role"),
      status: column("space_participations.status"),
      spaceNickname: column("space_participations.space_nickname"),
    },
    invitations: {
      id: column("space_invitations.id"),
      spaceId: column("space_invitations.space_id"),
      invitedUserId: column("space_invitations.invited_user_id"),
      status: column("space_invitations.status"),
    },
    codeRequests: {
      id: column("space_code_requests.id"),
      spaceId: column("space_code_requests.space_id"),
      requesterId: column("space_code_requests.requester_id"),
      status: column("space_code_requests.status"),
      spaceNickname: column("space_code_requests.space_nickname"),
    },
  };

  const responses: unknown[][] = [];
  const inserts: Array<{ table: unknown; values: Record<string, unknown> }> = [];

  const nextRows = () => responses.shift() ?? [];
  const db: any = {
    transaction: async (callback: (tx: any) => unknown) => callback(db),
    execute: vi.fn(async () => []),
    select: () => {
      const rows = nextRows();
      const chain = {
        from: () => chain,
        where: () => chain,
        orderBy: () => chain,
        groupBy: () => Promise.resolve(rows),
        limit: () => Promise.resolve(rows),
        then: (resolve: (value: unknown[]) => unknown, reject?: (reason: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    },
    insert: (table: unknown) => ({
      values: (values: Record<string, unknown>) => {
        inserts.push({ table, values });
        return {
          returning: async () => [{ id: `created-${inserts.length}`, ...values }],
        };
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>) => ({
        where: () => ({
          returning: async () => [{ id: "updated", ...values }],
        }),
      }),
    }),
  };

  return { activeUser: "", tables, responses, inserts, db };
});

vi.mock("@workspace/db", () => ({
  db: state.db,
  spacesTable: state.tables.spaces,
  spaceParticipationsTable: state.tables.participations,
  spaceInvitationsTable: state.tables.invitations,
  spaceCodeRequestsTable: state.tables.codeRequests,
  spaceRoundsTable: {},
  spaceRoundSlotsTable: {},
  spaceLettersTable: {},
  spaceScheduledSendsTable: {},
  usersTable: {},
  articlesTable: {},
  userArticleReadsTable: {},
}));

vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (
    req: { header: (name: string) => string | undefined; user?: { id: string } },
    res: { status: (status: number) => { json: (body: unknown) => void } },
    next: () => void,
  ) => {
    state.activeUser = req.header("x-test-user-id") ?? "";
    if (!state.activeUser) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.user = { id: state.activeUser };
    next();
  },
}));

const { default: router } = await import("./spaces");

const recruitingSpace = (overrides: Partial<Space> = {}): Space => ({
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  inviteCode: "봄바람",
  isAnonymous: false,
  status: "RECRUITING",
  maxParticipants: 2,
  ...overrides,
});

function queueRows(...rows: unknown[][]) {
  state.responses.push(...rows);
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

function request(baseUrl: string, userId: string, path: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-test-user-id": userId },
    body: JSON.stringify(body),
  });
}

function patch(baseUrl: string, userId: string, path: string, body: Record<string, unknown>) {
  return fetch(`${baseUrl}${path}`, {
    method: "PATCH",
    headers: { "content-type": "application/json", "x-test-user-id": userId },
    body: JSON.stringify(body),
  });
}

function get(baseUrl: string, path: string, userId?: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: userId ? { "x-test-user-id": userId } : undefined,
  });
}

beforeEach(() => {
  state.activeUser = "";
  state.responses.length = 0;
  state.inserts.length = 0;
  state.db.execute.mockClear();
});

afterAll(() => vi.restoreAllMocks());

describe("space join API contract", () => {
  it("accepts valid code applications for anonymous and real-name spaces", async () => {
    await withServer(async (baseUrl) => {
      const realNameSpace = recruitingSpace();
      queueRows(
        [realNameSpace], [realNameSpace], [], [], [{ value: 0 }],
        [recruitingSpace({ isAnonymous: true })], [recruitingSpace({ isAnonymous: true })], [], [], [{ value: 0 }], [], [],
      );

      const realNameResponse = await request(baseUrl, "user-a", "/spaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/code-requests", {
        code: "봄바람",
      });
      expect(realNameResponse.status).toBe(201);
      expect(state.inserts[0]?.values).toMatchObject({
        requesterId: "user-a",
        code: "봄바람",
      });
      expect(state.inserts[0]?.values).not.toHaveProperty("spaceNickname");

      const anonymousResponse = await request(baseUrl, "user-b", "/spaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/code-requests", {
        code: "봄바람",
        spaceNickname: "달빛",
      });
      expect(anonymousResponse.status).toBe(201);
      expect(state.inserts[1]?.values).toMatchObject({
        requesterId: "user-b",
        code: "봄바람",
        spaceNickname: "달빛",
      });
    });
  });

  it.each([
    ["wrong code", [[recruitingSpace()], [recruitingSpace()]], { code: "다른코드" }, 400, "INVITE_CODE_MISMATCH"],
    ["pending application", [[recruitingSpace()], [recruitingSpace()], [{ id: "pending" }]], { code: "봄바람" }, 409, "DUPLICATE_CODE_REQUEST"],
    ["missing anonymous nickname", [[recruitingSpace({ isAnonymous: true })], [recruitingSpace({ isAnonymous: true })], []], { code: "봄바람" }, 400, "MISSING_NICKNAME"],
    ["existing participation", [[recruitingSpace()], [recruitingSpace()], [], [{ id: "participation" }]], { code: "봄바람" }, 409, "ALREADY_PARTICIPATING"],
    ["closed recruitment", [[recruitingSpace({ status: "ACTIVE" })], [recruitingSpace({ status: "ACTIVE" })], [], []], { code: "봄바람" }, 409, "SPACE_NOT_RECRUITING"],
    ["full recruitment", [[recruitingSpace()], [recruitingSpace()], [], [], [{ value: 2 }]], { code: "봄바람" }, 409, "SPACE_FULL"],
    ["nickname conflict", [[recruitingSpace({ isAnonymous: true })], [recruitingSpace({ isAnonymous: true })], [], [], [{ value: 0 }], [{ id: "taken" }]], { code: "봄바람", spaceNickname: "달빛" }, 409, "NICKNAME_CONFLICT"],
  ])("returns %s as a distinct recovery code", async (_name, rows, body, status, code) => {
    await withServer(async (baseUrl) => {
      queueRows(...rows);
      const response = await request(baseUrl, "user-a", "/spaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/code-requests", body);
      expect(response.status).toBe(status);
      await expect(response.json()).resolves.toMatchObject({ code });
    });
  });

  it("blocks invitation acceptance once recruitment closes and creates a participation when it remains open", async () => {
    await withServer(async (baseUrl) => {
      const closedSpace = recruitingSpace({ status: "ACTIVE" });
      const invitation = { id: "invite-a", spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", invitedUserId: "user-a", status: "PENDING" };
      queueRows([invitation], [closedSpace], [closedSpace], [invitation], []);

      const closedResponse = await patch(baseUrl, "user-a", "/spaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/invitations/invite-a", {
        status: "ACCEPTED",
      });
      expect(closedResponse.status).toBe(409);
      await expect(closedResponse.json()).resolves.toMatchObject({ code: "SPACE_NOT_RECRUITING" });

      const openSpace = recruitingSpace();
      queueRows([invitation], [openSpace], [openSpace], [invitation], [], [{ value: 0 }]);
      const acceptedResponse = await patch(baseUrl, "user-a", "/spaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/invitations/invite-a", {
        status: "ACCEPTED",
      });
      expect(acceptedResponse.status).toBe(200);
      expect(state.inserts.at(-1)?.values).toMatchObject({
        spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        userId: "user-a",
        joinPath: "INVITATION",
        status: "APPROVED",
      });
    });
  });

  it("returns already-responded before checking an anonymous nickname on an acceptance retry", async () => {
    await withServer(async (baseUrl) => {
      const anonymousSpace = recruitingSpace({ isAnonymous: true });
      const handledInvitation = {
        id: "invite-a",
        spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
        invitedUserId: "user-a",
        status: "ACCEPTED",
      };
      queueRows([handledInvitation], [anonymousSpace], [anonymousSpace], [handledInvitation]);

      const response = await patch(baseUrl, "user-a", "/spaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/invitations/invite-a", {
        status: "ACCEPTED",
      });

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toMatchObject({ code: "ALREADY_RESPONDED" });
    });
  });

  it("requires authentication before exposing participation-specific join context", async () => {
    await withServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/spaces/aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa/join-context?userId=another-user`);
      expect(response.status).toBe(401);
    });
  });
});

describe("non-UUID space identifiers", () => {
  it("returns a JSON 404 instead of a 500 for GET /spaces/:id", async () => {
    await withServer(async (baseUrl) => {
      const response = await get(baseUrl, "/spaces/zzz-not-a-real-route");
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
    });
  });

  it("returns a JSON 404 for an unregistered sub-route that falls through to /spaces/:id", async () => {
    // Simulates a client calling an endpoint that doesn't exist on the running
    // server build: the request falls through to /spaces/:id with the whole
    // unmatched segment as the id, which must not throw inside the DB query.
    await withServer(async (baseUrl) => {
      const response = await get(baseUrl, "/spaces/operator-pending-code-requests-v2");
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
    });
  });

  it("returns a JSON 404 for a non-UUID id on an authenticated sub-route, before auth even runs", async () => {
    await withServer(async (baseUrl) => {
      const response = await get(baseUrl, "/spaces/not-a-uuid/basic-settings");
      expect(response.status).toBe(404);
      await expect(response.json()).resolves.toMatchObject({ error: expect.any(String) });
    });
  });

  it("still returns 404 (not 500) for a well-formed but non-existent UUID", async () => {
    await withServer(async (baseUrl) => {
      queueRows([]);
      const response = await get(baseUrl, "/spaces/00000000-0000-4000-8000-000000000000");
      expect(response.status).toBe(404);
    });
  });
});

describe("operator pending code request summary", () => {
  it("requires authentication", async () => {
    await withServer(async (baseUrl) => {
      const response = await get(baseUrl, "/spaces/operator-pending-code-requests");
      expect(response.status).toBe(401);
    });
  });

  it("is registered as its own route rather than falling through to /spaces/:id", async () => {
    // If this endpoint were missing from a deployed build, the request would
    // fall through to GET /spaces/:id and 404 (see "non-UUID space
    // identifiers" above) instead of hitting requireAuth and returning 401.
    // Asserting 401 here — not 404 — is what proves the route itself exists.
    await withServer(async (baseUrl) => {
      const response = await get(baseUrl, "/spaces/operator-pending-code-requests");
      expect(response.status).toBe(401);
      await expect(response.json()).resolves.not.toMatchObject({
        error: "Space not found",
      });
    });
  });

  it("returns one sorted row per operated space and omits unmatched spaces", async () => {
    await withServer(async (baseUrl) => {
      queueRows(
        [{ spaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb" }, { spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" }],
        [
          { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "베타 공간", status: "RECRUITING" },
          { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "가나다 공간", status: "ACTIVE" },
        ],
        [
          { spaceId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", pendingCount: "1" },
          { spaceId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", pendingCount: 2 },
          { spaceId: "another-operator-space", pendingCount: 4 },
        ],
      );

      const response = await get(
        baseUrl,
        "/spaces/operator-pending-code-requests",
        "operator-a",
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual([
        {
          space: { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "가나다 공간", status: "ACTIVE" },
          pendingCount: 2,
        },
        {
          space: { id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", name: "베타 공간", status: "RECRUITING" },
          pendingCount: 1,
        },
      ]);
    });
  });

  it("returns an empty list when the user operates no spaces", async () => {
    await withServer(async (baseUrl) => {
      queueRows([]);

      const response = await get(
        baseUrl,
        "/spaces/operator-pending-code-requests",
        "participant-a",
      );

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual([]);
    });
  });

  it("scopes the database predicates to the authenticated approved operator and pending requests", () => {
    const source = readFileSync(new URL("./spaces.ts", import.meta.url), "utf8");
    const routeStart = source.indexOf(
      'router.get("/spaces/operator-pending-code-requests"',
    );
    const routeEnd = source.indexOf(
      "// ─── List spaces",
      routeStart,
    );
    const route = source.slice(routeStart, routeEnd);

    expect(route).toContain("const callerId = req.user!.id");
    expect(route).toContain('eq(spaceParticipationsTable.role, "OPERATOR")');
    expect(route).toContain('eq(spaceParticipationsTable.status, "APPROVED")');
    expect(route).toContain('eq(spaceCodeRequestsTable.status, "PENDING")');
    expect(route).toContain('ne(spacesTable.status, "ARCHIVED")');
  });
});