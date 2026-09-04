import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import express, { type Express } from "express";
import type { Server } from "node:http";
import type { RequestHandler } from "express";

// The handlers are deliberately imported after these non-secret test settings
// so this boundary test never needs real Supabase credentials or a database.
process.env.EXPO_PUBLIC_SUPABASE_URL = "https://unit-project.supabase.co";
process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY = "unit-anon-key";
process.env.SUPABASE_DB_URL =
  "postgresql://postgres:password@db.unit-project.supabase.co:5432/postgres";

const { createRequireAuth } = await import("../middlewares/requireAuth");
const { createUserSyncHandler } = await import("./users");
const { createReadinessHandler } = await import("./health");
const { getSafeAuthFlowDiagnostic } = await import("./clientLogs");

const flowId = "af_m5rf1aa1b2c3d4e5";
const userId = "11111111-1111-4111-8111-111111111111";
const email = "signup-contract@example.test";

function createDatabase(result: () => Promise<unknown>) {
  const execute = vi.fn(() => Promise.resolve());
  const insert = vi.fn(() => ({
    values: vi.fn(() => ({
      onConflictDoUpdate: vi.fn(() => ({
        returning: vi.fn(result),
      })),
    })),
  }));
  return {
    execute,
    insert,
    transaction: vi.fn(async (
      callback: (tx: { execute: typeof execute; insert: typeof insert }) => Promise<unknown>,
    ) => callback({ execute, insert })),
  };
}

const silentLogger = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
};

async function withServer(
  handler: RequestHandler,
  test: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const app: Express = express();
  app.use(express.json());
  app.post("/api/users/sync", handler);
  const server = await new Promise<Server>((resolve) => {
    const listening = app.listen(0, () => resolve(listening));
  });

  try {
    const address = server.address() as AddressInfo;
    await test(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

function syncRequest(baseUrl: string) {
  return fetch(`${baseUrl}/api/users/sync`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: "Bearer intentionally-not-a-real-token",
      "x-auth-flow-id": flowId,
    },
    body: JSON.stringify({ id: userId, email, nickname: "contract" }),
  });
}

function authenticatedUser() {
  return async () => ({ data: { user: { id: userId, email } }, error: null });
}

describe("POST /api/users/sync contract", () => {
  beforeAll(() => vi.clearAllMocks());
  afterAll(() => vi.restoreAllMocks());

  it("creates a profile only after bearer authentication and returns the anonymous flow id", async () => {
    const database = createDatabase(
      () => Promise.resolve([{ id: userId, email, nickname: "contract" }]),
    );
    const handler = [
      createRequireAuth({ getUser: authenticatedUser() }),
      createUserSyncHandler({ database: database as never, log: silentLogger }),
    ];

    await withServer(handler as unknown as RequestHandler, async (baseUrl) => {
      const response = await syncRequest(baseUrl);
      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({
        diagnosticId: flowId,
        user: { id: userId, nickname: "contract" },
      });
    });
    expect(database.insert).toHaveBeenCalledOnce();
    expect(database.transaction).toHaveBeenCalledOnce();
  });

  it("distinguishes invalid tokens and delayed authentication services", async () => {
    await withServer(
      createRequireAuth({
        getUser: async () => ({ data: { user: null }, error: new Error("invalid") }),
      }),
      async (baseUrl) => {
        const response = await syncRequest(baseUrl);
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({ code: "AUTH_INVALID" });
      },
    );

    await withServer(
      createRequireAuth({
        getUser: () => new Promise(() => {}),
        timeoutMs: 5,
      }),
      async (baseUrl) => {
        const response = await syncRequest(baseUrl);
        expect(response.status).toBe(503);
        expect(await response.json()).toMatchObject({ code: "AUTH_UNAVAILABLE" });
      },
    );
  });

  it("rejects a missing or blank bearer token without calling the auth service", async () => {
    const getUser = vi.fn(authenticatedUser());
    const handler = createRequireAuth({ getUser });

    await withServer(handler, async (baseUrl) => {
      for (const authorization of [undefined, "Bearer   "]) {
        const response = await fetch(`${baseUrl}/api/users/sync`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(authorization ? { authorization } : {}),
          },
          body: JSON.stringify({ id: userId, email }),
        });
        expect(response.status).toBe(401);
        expect(await response.json()).toMatchObject({ code: "AUTH_REQUIRED" });
      }
    });

    expect(getUser).not.toHaveBeenCalled();
  });

  it("accepts the case-insensitive bearer scheme and trims the token", async () => {
    const getUser = vi.fn(async (token: string) => {
      expect(token).toBe("valid-token");
      return { data: { user: { id: userId, email } }, error: null };
    });
    const database = createDatabase(
      () => Promise.resolve([{ id: userId, email, nickname: "contract" }]),
    );
    const handler = [
      createRequireAuth({ getUser }),
      createUserSyncHandler({ database: database as never, log: silentLogger }),
    ];

    await withServer(handler as unknown as RequestHandler, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/api/users/sync`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "bEaReR   valid-token  ",
          "x-auth-flow-id": flowId,
        },
        body: JSON.stringify({ id: userId, email, nickname: "contract" }),
      });
      expect(response.status).toBe(200);
    });
    expect(getUser).toHaveBeenCalledOnce();
  });

  it("rejects an authenticated identity mismatch before the database write", async () => {
    const database = createDatabase(() => Promise.resolve([]));
    const handler = [
      createRequireAuth({
        getUser: async () => ({
          data: { user: { id: "22222222-2222-4222-8222-222222222222", email } },
          error: null,
        }),
      }),
      createUserSyncHandler({ database: database as never, log: silentLogger }),
    ];

    await withServer(handler as unknown as RequestHandler, async (baseUrl) => {
      const response = await syncRequest(baseUrl);
      expect(response.status).toBe(403);
      expect(await response.json()).toMatchObject({
        code: "SYNC_IDENTITY_MISMATCH",
        diagnosticId: flowId,
      });
    });
    expect(database.insert).not.toHaveBeenCalled();
    expect(database.transaction).not.toHaveBeenCalled();
  });

  it("returns stable conflict and database-unavailable codes without database details", async () => {
    for (const [failure, expectedCode, expectedStatus] of [
      [Object.assign(new Error("duplicate"), { cause: { code: "23505" } }), "SYNC_EMAIL_CONFLICT", 409],
      [new Error("connection refused"), "SYNC_DATABASE_UNAVAILABLE", 503],
    ] as const) {
      const database = createDatabase(() => Promise.reject(failure));
      const handler = [
        createRequireAuth({ getUser: authenticatedUser() }),
        createUserSyncHandler({ database: database as never, log: silentLogger }),
      ];

      await withServer(handler as unknown as RequestHandler, async (baseUrl) => {
        const response = await syncRequest(baseUrl);
        expect(response.status).toBe(expectedStatus);
        const body = await response.json();
        expect(body).toMatchObject({ code: expectedCode, diagnosticId: flowId });
        expect(JSON.stringify(body)).not.toContain("connection refused");
      });
    }
  });

  it("fails the atomic sync when impression-folder repair fails", async () => {
    const database = createDatabase(
      () => Promise.resolve([{ id: userId, email, nickname: "contract" }]),
    );
    database.execute.mockRejectedValueOnce(new Error("repair unavailable"));
    const handler = [
      createRequireAuth({ getUser: authenticatedUser() }),
      createUserSyncHandler({ database: database as never, log: silentLogger }),
    ];

    await withServer(handler as unknown as RequestHandler, async (baseUrl) => {
      const response = await syncRequest(baseUrl);
      expect(response.status).toBe(503);
      const body = await response.json();
      expect(body).toMatchObject({
        code: "SYNC_DATABASE_UNAVAILABLE",
        diagnosticId: flowId,
      });
      expect(JSON.stringify(body)).not.toContain("repair unavailable");
    });
    expect(database.transaction).toHaveBeenCalledOnce();
    expect(database.insert).toHaveBeenCalledOnce();
  });
});

describe("GET /api/readyz contract", () => {
  it("reports a target mismatch and database failure as deployment failures", async () => {
    const app = express();
    app.get(
      "/api/readyz",
      createReadinessHandler({
        inspect: () => ({ status: "SUPABASE_PROJECT_MISMATCH" }),
      }),
    );
    const server = await new Promise<Server>((resolve) => {
      const listening = app.listen(0, () => resolve(listening));
    });

    try {
      const address = server.address() as AddressInfo;
      const mismatch = await fetch(`http://127.0.0.1:${address.port}/api/readyz`);
      expect(mismatch.status).toBe(503);
      expect(await mismatch.json()).toEqual({
        status: "unavailable",
        code: "SUPABASE_PROJECT_MISMATCH",
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});

describe("auth-flow diagnostic privacy contract", () => {
  it("keeps only allowlisted classes and device metadata", () => {
    expect(
      getSafeAuthFlowDiagnostic({
        message: `phase=profile-sync;outcome=failed;flow=${flowId}`,
        name: "SYNC_DATABASE_UNAVAILABLE",
        platform: "ios",
        appVersion: "1.0.0",
        buildNumber: "17",
      }),
    ).toEqual({
      phase: "profile-sync",
      outcome: "failed",
      flowId,
      errorClass: "SYNC_DATABASE_UNAVAILABLE",
      platform: "ios",
        release: null,
    });
  });

  it("keeps the popup's signup code and diagnostic number searchable in safe logs", () => {
    expect(
      getSafeAuthFlowDiagnostic({
        message: `phase=sign-up;outcome=failed;flow=${flowId}`,
        name: "SIGNUP_API_UNREACHABLE",
        platform: "ios",
      }),
    ).toMatchObject({
      phase: "sign-up",
      outcome: "failed",
      flowId,
      errorClass: "SIGNUP_API_UNREACHABLE",
      platform: "ios",
    });
  });

  it("drops arbitrary values that could contain personal data or tokens", () => {
    expect(
      getSafeAuthFlowDiagnostic({
        message: `phase=profile-sync;outcome=failed;flow=${flowId}`,
        name: "person@example.test access-token-value",
        platform: "web-with-email@example.test",
      }),
    ).toEqual({
      phase: "profile-sync",
      outcome: "failed",
      flowId,
      errorClass: null,
      platform: null,
        release: null,
    });
  });

  it("rejects token-shaped values in every constrained message field", () => {
    for (const message of [
      "phase=profile-sync;outcome=sk_secretvalue;flow=af_m5rf1aa1b2c3d4e5",
      "phase=raw-error;outcome=failed;flow=af_m5rf1aa1b2c3d4e5",
      "phase=profile-sync;outcome=failed;flow=sk_secretvalue",
    ]) {
      expect(
        getSafeAuthFlowDiagnostic({
          message,
          name: "SYNC_UNKNOWN",
          platform: "android",
        }),
      ).toBeNull();
    }
  });

  it("records only safe release identity fields on auth-flow diagnostics", () => {
    expect(
      getSafeAuthFlowDiagnostic({
        message: `phase=profile-sync;outcome=failed;flow=${flowId}`,
        name: "SYNC_DATABASE_UNAVAILABLE",
        platform: "ios",
        release: {
          track: "production",
          configurationState: "valid",
          configurationFingerprint: "0123456789abcdef",
          supabaseHost: "project.supabase.co",
          apiHost: "friction-1.replit.app",
        },
      }),
    ).toMatchObject({
      release: {
        track: "production",
        configurationState: "valid",
        configurationFingerprint: "0123456789abcdef",
        supabaseHost: "project.supabase.co",
        apiHost: "friction-1.replit.app",
      },
    });
  });

  it("omits arbitrary release fields from auth-flow diagnostics", () => {
    expect(
      getSafeAuthFlowDiagnostic({
        message: `phase=profile-sync;outcome=failed;flow=${flowId}`,
        release: {
          track: "production",
          configurationState: "invalid",
          configurationFingerprint: "access-token-value",
          supabaseHost: "access-token-value",
          apiHost: "connection_refused",
        },
      }),
    ).toMatchObject({
      release: {
        track: "production",
        configurationState: "invalid",
        configurationFingerprint: null,
        supabaseHost: null,
        apiHost: null,
      },
    });
  });
});