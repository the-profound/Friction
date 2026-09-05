import { describe, expect, it, vi } from "vitest";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import express from "express";
import healthRouter, { createReadinessHandler } from "./health";

async function withHealthServer(test: (baseUrl: string) => Promise<void>) {
  const app = express();
  app.use(healthRouter);
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

function createResponse() {
  const response = {
    statusCode: 200,
    body: undefined as unknown,
    status: vi.fn((statusCode: number) => {
      response.statusCode = statusCode;
      return response;
    }),
    json: vi.fn((body: unknown) => {
      response.body = body;
      return response;
    }),
  };
  return response;
}

const request = {
  id: "req_abcdefghijklmnopqrst",
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
};

describe("readiness operational signals", () => {
  it("reports a successful DB ping", async () => {
    const response = createResponse();
    await createReadinessHandler({
      inspect: () => ({ status: "ready" }) as never,
      pingDatabase: async () => undefined,
      timeoutMs: 10,
    })(request as never, response as never);

    expect(response.statusCode).toBe(200);
    expect(response.body).toEqual({ status: "ready" });
    expect(request.log.info).toHaveBeenCalledWith(
      expect.objectContaining({ operation: "db.readiness", outcome: "success" }),
      expect.any(String),
    );
  });

  it("classifies a DB timeout without exposing an upstream message", async () => {
    const response = createResponse();
    await createReadinessHandler({
      inspect: () => ({ status: "ready" }) as never,
      pingDatabase: () => new Promise(() => undefined),
      timeoutMs: 1,
    })(request as never, response as never);

    expect(response.statusCode).toBe(503);
    expect(response.body).toEqual({
      status: "unavailable",
      code: "DATABASE_UNAVAILABLE",
    });
    const serialized = JSON.stringify(request.log.error.mock.calls);
    expect(serialized).toContain("database_timeout");
    expect(serialized).toContain("readiness_failed");
  });
});

describe("GET /version", () => {
  it("reports an opaque build id and the currently supported feature set", async () => {
    await withHealthServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/version`);
      expect(response.status).toBe(200);
      const body = (await response.json()) as { buildId: string; features: string[] };
      expect(typeof body.buildId).toBe("string");
      expect(body.buildId.length).toBeGreaterThan(0);
      expect(body.features.sort()).toEqual(
        [
          "activateThoughtQuestion",
          "getThought",
          "getThoughtQuestionQueue",
          "refreshThoughtQuestionQueue",
        ].sort(),
      );
    });
  });

  it("never includes request-identifying or credential-like fields", async () => {
    await withHealthServer(async (baseUrl) => {
      const body = (await (await fetch(`${baseUrl}/version`)).json()) as Record<
        string,
        unknown
      >;
      expect(Object.keys(body).sort()).toEqual(["buildId", "features"]);
    });
  });

  it("returns a stable build id across repeated requests within one process", async () => {
    await withHealthServer(async (baseUrl) => {
      const first = (await (await fetch(`${baseUrl}/version`)).json()) as { buildId: string };
      const second = (await (await fetch(`${baseUrl}/version`)).json()) as { buildId: string };
      expect(second.buildId).toBe(first.buildId);
    });
  });

  it("is reachable without authentication", async () => {
    await withHealthServer(async (baseUrl) => {
      const response = await fetch(`${baseUrl}/version`, {
        headers: { authorization: "" },
      });
      expect(response.status).toBe(200);
    });
  });
});