import { describe, expect, it, vi } from "vitest";
import {
  classifyOperationalError,
  correlationIdMiddleware,
  createCorrelationId,
  isSafeCorrelationId,
  logOperationalMetric,
  REQUEST_ID_HEADER,
  resetOperationalTelemetryForTests,
} from "./operationalTelemetry";

describe("operational telemetry privacy and correlation", () => {
  it("accepts only the fixed opaque request-id format", () => {
    expect(isSafeCorrelationId(createCorrelationId())).toBe(true);
    expect(isSafeCorrelationId("customer@example.com")).toBe(false);
    expect(isSafeCorrelationId("Bearer secret-token")).toBe(false);
  });

  it("reuses a safe mobile request id and returns it in the response", () => {
    const requestId = "req_abcdefghijklmnopqrst";
    const req = {
      id: undefined,
      header: vi.fn((name: string) =>
        name === REQUEST_ID_HEADER ? requestId : undefined),
    };
    const res = { setHeader: vi.fn() };
    const next = vi.fn();

    correlationIdMiddleware(req as never, res as never, next);

    expect(req.id).toBe(requestId);
    expect(res.setHeader).toHaveBeenCalledWith(REQUEST_ID_HEADER, requestId);
    expect(next).toHaveBeenCalledOnce();
  });

  it("logs only stable failure classes, never raw error messages", () => {
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    const error = Object.assign(new Error("letter body customer@example.com"), {
      code: "08006",
    });

    expect(classifyOperationalError(error)).toBe("db_connection");
    logOperationalMetric(log as never, {
      operation: "db.readiness",
      outcome: "failure",
      durationMs: 4,
      failureType: classifyOperationalError(error),
    });

    const serialized = JSON.stringify(log.error.mock.calls);
    expect(serialized).toContain("db_connection");
    expect(serialized).not.toContain("customer@example.com");
    expect(serialized).not.toContain("letter body");
  });

  it("emits actionable alerts for push and repeated storage failures", () => {
    resetOperationalTelemetryForTests();
    const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    logOperationalMetric(log as never, {
      operation: "push.send",
      outcome: "failure",
      durationMs: 12,
      successCount: 0,
      failureCount: 2,
    });
    for (let count = 0; count < 3; count += 1) {
      logOperationalMetric(log as never, {
        operation: "storage.download",
        outcome: "failure",
        durationMs: 12,
        failureType: "upstream_5xx",
      });
    }

    const serialized = JSON.stringify(log.error.mock.calls);
    expect(serialized).toContain("push_failure_rate");
    expect(serialized).toContain("storage_failures");
  });
});