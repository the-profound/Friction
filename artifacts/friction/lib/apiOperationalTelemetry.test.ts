import { afterEach, describe, expect, it, vi } from "vitest";
import {
  customFetch,
  setAuthRefreshCallback,
  setAuthTokenGetter,
  setRequestTelemetryObserver,
  type ApiRequestTelemetry,
} from "@workspace/api-client-react";

describe("mobile API operational telemetry", () => {
  afterEach(() => {
    setAuthRefreshCallback(null);
    setAuthTokenGetter(null);
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

  it("attaches the bearer token and retries one rejected request with a refreshed token", async () => {
    setAuthTokenGetter(() => "stale-token");
    const refresh = vi.fn().mockResolvedValue("fresh-token");
    setAuthRefreshCallback(refresh);
    const sentAuthorization: Array<string | null> = [];
    const fetchMock = vi.fn(async (_input: unknown, init?: RequestInit) => {
      sentAuthorization.push(new Headers(init?.headers).get("authorization"));
      return sentAuthorization.length === 1
        ? new Response(JSON.stringify({ code: "AUTH_INVALID" }), {
          status: 401,
          headers: { "content-type": "application/json" },
        })
        : new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      customFetch("https://api.example.test/api/users/sync", {
        method: "POST",
        body: JSON.stringify({ id: "opaque-id", email: "hidden@example.test" }),
        responseType: "json",
      }),
    ).resolves.toEqual({ ok: true });

    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentAuthorization).toEqual(["Bearer stale-token", "Bearer fresh-token"]);
  });

  it("does not replace an explicitly supplied authorization header", async () => {
    setAuthTokenGetter(() => "getter-token");
    const refresh = vi.fn().mockResolvedValue("fresh-token");
    setAuthRefreshCallback(refresh);
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ code: "AUTH_INVALID" }), {
        status: 401,
        headers: { "content-type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      customFetch("https://api.example.test/api/users/sync", {
        headers: { authorization: "Bearer caller-token" },
        responseType: "json",
      }),
    ).rejects.toMatchObject({ status: 401 });

    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(new Headers(fetchMock.mock.calls[0]?.[1]?.headers).get("authorization")).toBe(
      "Bearer caller-token",
    );
  });
});