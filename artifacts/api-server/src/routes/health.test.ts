import { describe, expect, it, vi } from "vitest";
import { createReadinessHandler } from "./health";

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