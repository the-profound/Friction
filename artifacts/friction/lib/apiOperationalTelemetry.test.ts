import { afterEach, describe, expect, it, vi } from "vitest";
import {
  customFetch,
  setRequestTelemetryObserver,
  type ApiRequestTelemetry,
} from "@workspace/api-client-react";

describe("mobile API operational telemetry", () => {
  afterEach(() => {
    setRequestTelemetryObserver(null);
    vi.unstubAllGlobals();
  });

  it("propagates an opaque request id and strips entity ids and query data", async () => {
    const events: ApiRequestTelemetry[] = [];
    setRequestTelemetryObserver((event) => events.push(event));
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      const requestId = new Headers(init?.headers).get("x-request-id");
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: {
          "content-type": "application/json",
          "x-request-id": requestId ?? "",
        },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await customFetch(
      "https://api.example.test/api/spaces/9bb31017-f045-4c4b-bf6f-59175d986531?email=private@example.com",
      { responseType: "json" },
    );

    const sentId = new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("x-request-id");
    expect(sentId).toMatch(/^req_[a-z0-9]{20,32}$/);
    expect(events).toEqual([
      expect.objectContaining({
        requestId: sentId,
        route: "/api/spaces/:id",
        outcome: "success",
      }),
    ]);
    expect(JSON.stringify(events)).not.toContain("private@example.com");
  });

  it("classifies transport failure without recording its message", async () => {
    const events: ApiRequestTelemetry[] = [];
    setRequestTelemetryObserver((event) => events.push(event));
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("token and letter body must not be captured");
      }),
    );

    await expect(customFetch("/api/readyz")).rejects.toThrow();
    expect(events[0]).toMatchObject({
      route: "/api/readyz",
      outcome: "network_error",
      failureType: "network",
    });
    expect(JSON.stringify(events)).not.toContain("letter body");
  });
});