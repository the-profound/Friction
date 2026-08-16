import { describe, expect, it, vi } from "vitest";
import {
  createNativeAutoRefreshController,
  createActiveSessionRestoreGate,
  isAccessTokenUsable,
  restoreNativeSession,
  type NativeAuthFacade,
  type SessionLike,
} from "./authSessionRecovery";

type TestSession = SessionLike & { id: string };

const now = new Date("2026-08-16T00:00:00.000Z").getTime();

function session(expiresInMs: number): TestSession {
  return {
    id: "session-1",
    access_token: "access-token",
    expires_at: Math.floor((now + expiresInMs) / 1000),
  };
}

function authWith(
  current: TestSession | null,
  refresh: { session: TestSession | null; error: unknown | null },
): NativeAuthFacade<TestSession> & {
  getSession: ReturnType<typeof vi.fn>;
  refreshSession: ReturnType<typeof vi.fn>;
  signOut: ReturnType<typeof vi.fn>;
} {
  return {
    getSession: vi.fn().mockResolvedValue({ data: { session: current }, error: null }),
    refreshSession: vi.fn().mockResolvedValue({ data: { session: refresh.session }, error: refresh.error }),
    signOut: vi.fn().mockResolvedValue({ error: null }),
  };
}

describe("restoreNativeSession", () => {
  it("keeps a valid stored session without refreshing it", async () => {
    const stored = session(60 * 60 * 1000);
    const auth = authWith(stored, { session: null, error: null });

    await expect(restoreNativeSession(auth, { now })).resolves.toEqual({
      session: stored,
      shouldRetryRefresh: false,
    });
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("refreshes a near-expiry stored session before authenticating", async () => {
    const refreshed = session(60 * 60 * 1000);
    const auth = authWith(session(30_000), { session: refreshed, error: null });

    await expect(restoreNativeSession(auth, { now })).resolves.toEqual({
      session: refreshed,
      shouldRetryRefresh: false,
    });
    expect(auth.refreshSession).toHaveBeenCalledTimes(1);
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("clears an invalid or rotated refresh token locally", async () => {
    const auth = authWith(session(-1_000), {
      session: null,
      error: {
        name: "AuthApiError",
        status: 400,
        message: "Invalid Refresh Token: Refresh Token Not Found",
      },
    });

    await expect(restoreNativeSession(auth, { now })).resolves.toEqual({
      session: null,
      shouldRetryRefresh: false,
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("clears an expired session when refresh yields no replacement session", async () => {
    const auth = authWith(session(-1_000), { session: null, error: null });

    await expect(restoreNativeSession(auth, { now })).resolves.toEqual({
      session: null,
      shouldRetryRefresh: false,
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("does not pass expired access tokens to the API client", () => {
    expect(isAccessTokenUsable(session(1_000), now)).toBe(true);
    expect(isAccessTokenUsable(session(0), now)).toBe(false);
    expect(isAccessTokenUsable(session(-1_000), now)).toBe(false);
  });

  it("keeps a transient refresh failure available for a foreground retry", async () => {
    const auth = authWith(session(-1_000), {
      session: null,
      error: { name: "AuthRetryableFetchError", status: 503 },
    });

    await expect(restoreNativeSession(auth, { now })).resolves.toEqual({
      session: null,
      shouldRetryRefresh: true,
    });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("defers a stale session refresh until the app becomes active", async () => {
    const auth = authWith(session(-1_000), {
      session: session(60 * 60 * 1000),
      error: null,
    });

    await expect(
      restoreNativeSession(auth, { now, canRefresh: false }),
    ).resolves.toEqual({
      session: null,
      shouldRetryRefresh: true,
    });
    expect(auth.refreshSession).not.toHaveBeenCalled();
    expect(auth.signOut).not.toHaveBeenCalled();
  });
});

describe("createNativeAutoRefreshController", () => {
  it("only refreshes while the app is active", async () => {
    const auth = {
      startAutoRefresh: vi.fn().mockResolvedValue(undefined),
      stopAutoRefresh: vi.fn().mockResolvedValue(undefined),
    };
    const controller = createNativeAutoRefreshController(auth);

    await controller.setAppState("active");
    await controller.setAppState("active");
    await controller.setAppState("background");
    await controller.setAppState("inactive");

    expect(auth.startAutoRefresh).toHaveBeenCalledTimes(1);
    expect(auth.stopAutoRefresh).toHaveBeenCalledTimes(1);
  });
});

describe("createActiveSessionRestoreGate", () => {
  it("does not read a session until the app is active", async () => {
    const restore = vi.fn().mockResolvedValue(undefined);
    const gate = createActiveSessionRestoreGate(restore);

    await gate.setAppState("background");
    await gate.setAppState("inactive");
    expect(restore).not.toHaveBeenCalled();

    await gate.setAppState("active");
    await gate.setAppState("active");
    expect(restore).toHaveBeenCalledTimes(1);
  });
});