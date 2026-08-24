import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  createAuthSessionCoordinator,
  createNativeAutoRefreshController,
  createActiveSessionRestoreGate,
  createNativeStorageAccessGate,
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

  it("clears a stored session whose refresh token has been deleted", async () => {
    const auth = authWith(session(-1_000), {
      session: null,
      error: { name: "AuthSessionMissingError", status: 400 },
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

  it("keeps a retryable session read failure available for a foreground retry", async () => {
    const auth = authWith(session(-1_000), { session: null, error: null });
    auth.getSession.mockResolvedValue({
      data: { session: null },
      error: { name: "AuthRetryableFetchError", status: 503 },
    });

    await expect(restoreNativeSession(auth, { now })).resolves.toEqual({
      session: null,
      shouldRetryRefresh: true,
    });
    expect(auth.signOut).not.toHaveBeenCalled();
  });

  it("clears a permanently invalid refresh error thrown by the SDK", async () => {
    const auth = authWith(session(-1_000), { session: null, error: null });
    auth.refreshSession.mockRejectedValue({
      name: "AuthApiError",
      status: 400,
      message: "Invalid Refresh Token",
    });

    await expect(restoreNativeSession(auth, { now })).resolves.toEqual({
      session: null,
      shouldRetryRefresh: false,
    });
    expect(auth.signOut).toHaveBeenCalledWith({ scope: "local" });
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

describe("createNativeStorageAccessGate", () => {
  it("keeps persisted auth storage closed until active restore owns it", () => {
    const gate = createNativeStorageAccessGate();

    expect(gate.canAccess()).toBe(false);
    gate.open();
    expect(gate.canAccess()).toBe(true);
  });

  it("blocks Supabase's constructor recovery from reading native storage", async () => {
    const gate = createNativeStorageAccessGate();
    const readPersistedSession = vi.fn().mockResolvedValue(null);
    const storage = {
      getItem: vi.fn(async (key: string) =>
        gate.canAccess() ? readPersistedSession(key) : null,
      ),
      setItem: vi.fn().mockResolvedValue(undefined),
      removeItem: vi.fn().mockResolvedValue(undefined),
    };
    const client = createClient("https://example.supabase.co", "anon-key", {
      auth: {
        storage,
        autoRefreshToken: false,
        persistSession: true,
        detectSessionInUrl: false,
      },
    });

    // Let GoTrue's module-time initialize() settle through its gated adapter.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(storage.getItem).toHaveBeenCalled();
    expect(readPersistedSession).not.toHaveBeenCalled();

    gate.open();
    await client.auth.getSession();
    expect(readPersistedSession).toHaveBeenCalledTimes(1);
  });
});

describe("createAuthSessionCoordinator", () => {
  it("does not let a late native restore replace a completed signup", () => {
    const coordinator = createAuthSessionCoordinator<TestSession>();
    const restoreOperation = coordinator.beginRestore();
    const signupOperation = coordinator.beginAuthOperation();
    const signupSession = session(60 * 60 * 1000);

    expect(coordinator.commitAuthOperation(signupOperation, signupSession)).toBe(true);
    expect(coordinator.completeRestore(restoreOperation, null)).toEqual({
      accepted: false,
      restoreComplete: true,
      session: signupSession,
    });
    expect(coordinator.getCurrentSession()).toBe(signupSession);
  });

  it("keeps a profile-sync failure authoritative over a late restore", () => {
    const coordinator = createAuthSessionCoordinator<TestSession>();
    const restoreOperation = coordinator.beginRestore();
    const signupOperation = coordinator.beginAuthOperation();

    expect(coordinator.commitAuthOperation(signupOperation, null)).toBe(true);
    expect(coordinator.completeRestore(restoreOperation, session(60 * 60 * 1000))).toEqual({
      accepted: false,
      restoreComplete: true,
      session: null,
    });
  });

  it("ignores delayed auth events after a failed operation until a new operation starts", () => {
    const coordinator = createAuthSessionCoordinator<TestSession>();
    const restoreOperation = coordinator.beginRestore();
    coordinator.completeRestore(restoreOperation, null);
    const failedOperation = coordinator.beginAuthOperation();

    expect(coordinator.commitAuthOperation(failedOperation, null)).toBe(true);
    expect(coordinator.receiveAuthEvent("SIGNED_IN", session(60 * 60 * 1000))).toEqual({
      accepted: false,
      session: null,
    });
    expect(coordinator.receiveAuthEvent("TOKEN_REFRESHED", session(60 * 60 * 1000))).toEqual({
      accepted: false,
      session: null,
    });

    const retryOperation = coordinator.beginAuthOperation();
    expect(coordinator.receiveAuthEvent("SIGNED_IN", session(60 * 60 * 1000))).toEqual({
      accepted: false,
      session: null,
    });
    const retrySession = session(60 * 60 * 1000);
    expect(coordinator.commitAuthOperation(retryOperation, retrySession)).toBe(true);
    expect(coordinator.receiveAuthEvent("TOKEN_REFRESHED", retrySession)).toEqual({
      accepted: true,
      session: retrySession,
    });
  });

  it("keeps explicit sign-out authoritative over delayed auth events", () => {
    const coordinator = createAuthSessionCoordinator<TestSession>();
    const restoreOperation = coordinator.beginRestore();
    const restored = session(60 * 60 * 1000);
    coordinator.completeRestore(restoreOperation, restored);

    coordinator.markExplicitSignOut();

    expect(coordinator.getCurrentSession()).toBeNull();
    expect(coordinator.receiveAuthEvent("SIGNED_OUT", null)).toEqual({
      accepted: false,
      session: null,
    });
    expect(coordinator.receiveAuthEvent("TOKEN_REFRESHED", restored)).toEqual({
      accepted: false,
      session: null,
    });
  });

  it("ignores duplicate initial auth events after explicit restore", () => {
    const coordinator = createAuthSessionCoordinator<TestSession>();
    const restoreOperation = coordinator.beginRestore();
    const restored = session(60 * 60 * 1000);

    expect(coordinator.completeRestore(restoreOperation, restored).accepted).toBe(true);
    expect(coordinator.receiveAuthEvent("INITIAL_SESSION", null)).toEqual({
      accepted: false,
      session: restored,
    });
    expect(coordinator.receiveAuthEvent("TOKEN_REFRESHED", restored)).toEqual({
      accepted: true,
      session: restored,
    });
  });

  it("accepts a foreground token refresh after a retryable startup failure", () => {
    const coordinator = createAuthSessionCoordinator<TestSession>();
    const restoreOperation = coordinator.beginRestore();
    const refreshed = session(60 * 60 * 1000);

    expect(
      coordinator.completeRestore(restoreOperation, null, {
        allowRefreshEvents: true,
      }),
    ).toEqual({
      accepted: true,
      restoreComplete: true,
      session: null,
    });
    expect(coordinator.receiveAuthEvent("INITIAL_SESSION", session(-1_000))).toEqual({
      accepted: false,
      session: null,
    });
    expect(coordinator.receiveAuthEvent("TOKEN_REFRESHED", refreshed)).toEqual({
      accepted: true,
      session: refreshed,
    });
  });

  it("accepts a foreground signed-out event after a valid restore", () => {
    const coordinator = createAuthSessionCoordinator<TestSession>();
    const restoreOperation = coordinator.beginRestore();
    const restored = session(60 * 60 * 1000);

    expect(coordinator.completeRestore(restoreOperation, restored).accepted).toBe(true);
    expect(coordinator.receiveAuthEvent("SIGNED_OUT", null)).toEqual({
      accepted: true,
      session: null,
    });
    expect(coordinator.getCurrentSession()).toBeNull();
  });

  it("does not apply auth events while a signup operation is in flight", () => {
    const coordinator = createAuthSessionCoordinator<TestSession>();
    const restoreOperation = coordinator.beginRestore();
    coordinator.completeRestore(restoreOperation, null);
    coordinator.beginAuthOperation();

    expect(coordinator.receiveAuthEvent("SIGNED_IN", session(60 * 60 * 1000))).toEqual({
      accepted: false,
      session: null,
    });
  });

  it("allows auto-confirmed signup immediately after invalid-session recovery", () => {
    const coordinator = createAuthSessionCoordinator<TestSession>();
    const restoreOperation = coordinator.beginRestore();
    const autoConfirmedSession = session(60 * 60 * 1000);

    expect(coordinator.completeRestore(restoreOperation, null).accepted).toBe(true);
    const signupOperation = coordinator.beginAuthOperation();
    expect(
      coordinator.receiveAuthEvent("SIGNED_IN", autoConfirmedSession),
    ).toEqual({
      accepted: false,
      session: null,
    });
    expect(
      coordinator.commitAuthOperation(signupOperation, autoConfirmedSession),
    ).toBe(true);
    expect(coordinator.getCurrentSession()).toBe(autoConfirmedSession);
  });
});