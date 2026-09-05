/**
 * Tests for custom-fetch resilience: 401 retry signal fix and per-request timeout.
 *
 * Key regression: when a slow request returns 401, the shared effectiveSignal
 * already has its timeout budget nearly (or fully) exhausted. Reusing it for
 * the retry caused an immediate AbortError before the retry could complete.
 * These tests lock in the fixed behaviour.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
  customFetch,
  setAuthRefreshCallback,
  setAuthTokenGetter,
} from "@workspace/api-client-react";

function makeJsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("custom-fetch 401 retry resilience", () => {
  afterEach(() => {
    setAuthRefreshCallback(null);
    setAuthTokenGetter(null);
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("retries 401 with a fresh timeout signal when the original has expired", async () => {
    // Arrange: the initial timeout signal we can expire manually.
    const firstTimeoutController = new AbortController();
    let timeoutCallCount = 0;
    vi.spyOn(AbortSignal, "timeout").mockImplementation(() => {
      timeoutCallCount++;
      if (timeoutCallCount === 1) return firstTimeoutController.signal;
      // Retry gets a genuinely fresh signal.
      return new AbortController().signal;
    });

    setAuthTokenGetter(() => "stale-token");
    const refresh = vi.fn().mockResolvedValue("fresh-token");
    setAuthRefreshCallback(refresh);

    const sentSignals: (AbortSignal | undefined)[] = [];
    const fetchMock = vi.fn().mockImplementation(async (_input: unknown, init?: RequestInit) => {
      sentSignals.push(init?.signal ?? undefined);
      if (fetchMock.mock.calls.length === 1) {
        // Simulate: timeout fires during the slow first request (the budget is
        // used up), but the server still responded with 401.
        firstTimeoutController.abort(new DOMException("timeout", "TimeoutError"));
        return makeJsonResponse(401, { code: "AUTH_INVALID" });
      }
      // Retry: a real browser/RN would throw if the signal were already aborted.
      if (init?.signal?.aborted) {
        throw init.signal.reason ?? new DOMException("aborted", "AbortError");
      }
      return makeJsonResponse(200, { ok: true });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Act + Assert: should resolve, not throw
    await expect(
      customFetch("https://api.example.test/api/thoughts/question-queue", {
        responseType: "json",
      }),
    ).resolves.toEqual({ ok: true });

    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    // Verify: the retry received a DIFFERENT signal from the expired original.
    const [firstSignal, retrySignal] = sentSignals;
    expect(firstSignal).toBeDefined();
    expect(retrySignal).toBeDefined();
    // The expired signal is aborted; the retry signal must NOT be.
    expect(firstSignal?.aborted).toBe(true);
    expect(retrySignal?.aborted).toBe(false);
  });

  it("does not retry when the caller's signal is explicitly aborted after receiving 401", async () => {
    // Arrange: caller's AbortController (simulates navigation away).
    const callerController = new AbortController();

    setAuthTokenGetter(() => "stale-token");
    const refresh = vi.fn().mockResolvedValue("fresh-token");
    setAuthRefreshCallback(refresh);

    const fetchMock = vi.fn().mockImplementation(async () => {
      // Caller aborts their signal mid-flight (they navigated away).
      callerController.abort(new DOMException("user cancelled", "AbortError"));
      return makeJsonResponse(401, { code: "AUTH_INVALID" });
    });
    vi.stubGlobal("fetch", fetchMock);

    // Act: pass the caller's signal so the code knows about explicit cancellation.
    await expect(
      customFetch("https://api.example.test/api/thoughts/question-queue", {
        signal: callerController.signal,
        responseType: "json",
      }),
    ).rejects.toMatchObject({ status: 401 });

    // Assert: refresh and retry were skipped because the caller cancelled.
    expect(refresh).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the per-request timeoutMs instead of the global default", async () => {
    const capturedMs: number[] = [];
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      capturedMs.push(ms);
      return new AbortController().signal;
    });

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(makeJsonResponse(200, { ok: true })),
    );

    await customFetch("https://api.example.test/api/thoughts/question-queue", {
      timeoutMs: 30_000,
      responseType: "json",
    });

    // buildTimeoutSignal must have been called with 30 000 ms, not 15 000.
    expect(capturedMs).toContain(30_000);
    expect(capturedMs).not.toContain(15_000);
  });

  it("succeeds on the 401 retry when the refresh produces a new token", async () => {
    // Baseline: happy-path 401 → refresh → 200 still works after the signal fix.
    setAuthTokenGetter(() => "stale-token");
    const refresh = vi.fn().mockResolvedValue("fresh-token");
    setAuthRefreshCallback(refresh);

    const sentAuthorization: Array<string | null> = [];
    const fetchMock = vi.fn().mockImplementation(async (_input: unknown, init?: RequestInit) => {
      sentAuthorization.push(new Headers(init?.headers).get("authorization"));
      return sentAuthorization.length === 1
        ? makeJsonResponse(401, { code: "AUTH_INVALID" })
        : makeJsonResponse(200, { result: "ok" });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(
      customFetch("https://api.example.test/api/users/me", { responseType: "json" }),
    ).resolves.toEqual({ result: "ok" });

    expect(refresh).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(sentAuthorization).toEqual(["Bearer stale-token", "Bearer fresh-token"]);
  });

  it("classifies an aborted request as a timeout outcome", async () => {
    // Signal already aborted (e.g. 30 s timeout fires on question-queue).
    const abortedController = new AbortController();
    abortedController.abort(new DOMException("timeout", "TimeoutError"));

    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => {
      throw new DOMException("timeout", "TimeoutError");
    }));

    await expect(
      customFetch("https://api.example.test/api/thoughts/question-queue", {
        signal: abortedController.signal,
      }),
    ).rejects.toMatchObject({ name: "TimeoutError" });
  });
});
