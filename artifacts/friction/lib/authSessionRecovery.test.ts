import { describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import {
  createAuthSessionCoordinator,
  createNativeAutoRefreshController,
  createActiveSessionRestoreGate,
  createNativeStorageAccessGate,
  isAccessTokenUsable,
  restoreNativeSession,
  waitForActiveAppState,
  type NativeAuthFacade,
  type SessionLike,
} from "./authSessionRecovery";
import {
  getActiveReadingForUser,
  getAuthNavigationDecision,
  getProtectedNavigationDecision,
} from "./authNavigation";
import {
  createAsyncOperationQueue,
  createRevisionGuard,
  isActiveReadingState,
} from "@/contexts/ActiveReadingContext";

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

describe("waitForActiveAppState", () => {
  it("waits through background and resolves once on foreground", async () => {
    let state = "background";
    let listener: ((next: string) => void) | undefined;
    const remove = vi.fn();
    const waiting = waitForActiveAppState({
      getCurrentState: () => state,
      subscribe: (next) => {
        listener = next;
        return { remove };
      },
    });

    let resolved = false;
    void waiting.then(() => {
      resolved = true;
    });
    await Promise.resolve();
    expect(resolved).toBe(false);

    state = "active";
    listener?.("active");
    await waiting;
    expect(remove).toHaveBeenCalledTimes(1);
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

describe("auth navigation boundary", () => {
  it("keeps a protected deep link behind the restore loading boundary", () => {
    expect(
      getAuthNavigationDecision({
        isLoading: true,
        userId: null,
        firstSegment: "read",
      }),
    ).toEqual({ kind: "loading" });
  });

  it("redirects an unauthenticated direct read entry instead of mounting it", () => {
    expect(
      getAuthNavigationDecision({
        isLoading: false,
        userId: null,
        firstSegment: "read",
      }),
    ).toEqual({ kind: "redirect-login" });
  });

  it("renders only the public stack on the login routes", () => {
    expect(
      getAuthNavigationDecision({
        isLoading: false,
        userId: null,
        firstSegment: "login",
      }),
    ).toEqual({ kind: "public" });
  });

  it("keys protected navigation to the current authenticated user", () => {
    const firstAccount = getAuthNavigationDecision({
      isLoading: false,
      userId: "user-a",
      firstSegment: "read",
    });
    const secondAccount = getAuthNavigationDecision({
      isLoading: false,
      userId: "user-b",
      firstSegment: "read",
    });
    expect(firstAccount).toEqual({ kind: "protected", userId: "user-a" });
    expect(secondAccount).toEqual({ kind: "protected", userId: "user-b" });
    expect(secondAccount).not.toEqual(firstAccount);
  });

  it("unmounts protected navigation as soon as the web session is lost", () => {
    const authenticated = getAuthNavigationDecision({
      isLoading: false,
      userId: "user-a",
      firstSegment: "read",
    });
    const signedOut = getAuthNavigationDecision({
      isLoading: false,
      userId: null,
      firstSegment: "read",
    });
    expect(authenticated.kind).toBe("protected");
    expect(signedOut).toEqual({ kind: "redirect-login" });
  });

  it("does not restore an active reading session owned by another account", () => {
    const activeSession = {
      userId: "user-a",
      articleId: "article-1",
      mode: "basic",
    };
    expect(getActiveReadingForUser(activeSession, "user-b")).toBeNull();
    expect(getActiveReadingForUser(activeSession, "user-a")).toBe(activeSession);
    expect(
      getActiveReadingForUser(
        { articleId: "legacy", mode: "basic" } as typeof activeSession,
        "user-a",
      ),
    ).toBeNull();
  });

  it("waits for delayed active-reading storage before choosing the native landing route", () => {
    expect(
      getProtectedNavigationDecision({
        shouldDecideInitialRoute: true,
        isActiveReadingHydrated: false,
        activeSession: null,
        userId: "user-a",
        pathname: "/",
        shouldOpenRecords: true,
      }),
    ).toEqual({ kind: "wait" });
  });

  it.each(["ios", "android"])("restores the same basic reading on %s cold start", () => {
    const activeSession = {
      userId: "user-a",
      articleId: "article-1",
      inboxId: "inbox-1",
      mode: "basic",
    };
    expect(
      getProtectedNavigationDecision({
        shouldDecideInitialRoute: true,
        isActiveReadingHydrated: true,
        activeSession,
        userId: "user-a",
        pathname: "/",
        shouldOpenRecords: true,
      }),
    ).toEqual({ kind: "restore-reading", activeSession });
  });

  it.each([
    ["ios", "/on"],
    ["ios", "/article-detail"],
    ["ios", "/read"],
    ["ios", "/on-01a"],
    ["android", "/on"],
    ["android", "/article-detail"],
    ["android", "/read"],
    ["android", "/on-01a"],
  ])("keeps the current %s route %s after returning to the foreground", (_platform, pathname) => {
    const activeSession = {
      userId: "user-a",
      articleId: "article-1",
      mode: "basic",
    };
    expect(
      getProtectedNavigationDecision({
        shouldDecideInitialRoute: false,
        isActiveReadingHydrated: true,
        activeSession,
        userId: "user-a",
        pathname,
        shouldOpenRecords: false,
      }),
    ).toEqual({ kind: "stay" });
  });

  it("opens records instead of restoring another account or cleared completion", () => {
    const otherAccountSession = {
      userId: "user-a",
      articleId: "article-1",
      mode: "basic",
    };
    expect(
      getProtectedNavigationDecision({
        shouldDecideInitialRoute: true,
        isActiveReadingHydrated: true,
        activeSession: otherAccountSession,
        userId: "user-b",
        pathname: "/",
        shouldOpenRecords: true,
      }),
    ).toEqual({ kind: "open-records" });
    expect(
      getProtectedNavigationDecision({
        shouldDecideInitialRoute: true,
        isActiveReadingHydrated: true,
        activeSession: null,
        userId: "user-a",
        pathname: "/",
        shouldOpenRecords: true,
      }),
    ).toEqual({ kind: "open-records" });
  });

  it("does not replace an already-open reading route or force a re-read session", () => {
    const basicSession = {
      userId: "user-a",
      articleId: "article-1",
      mode: "basic",
    };
    expect(
      getProtectedNavigationDecision({
        shouldDecideInitialRoute: false,
        isActiveReadingHydrated: true,
        activeSession: basicSession,
        userId: "user-a",
        pathname: "/read",
        shouldOpenRecords: false,
      }),
    ).toEqual({ kind: "stay" });
    expect(
      getProtectedNavigationDecision({
        shouldDecideInitialRoute: false,
        isActiveReadingHydrated: true,
        activeSession: null,
        userId: "user-a",
        pathname: "/read",
        shouldOpenRecords: false,
      }),
    ).toEqual({ kind: "stay" });
    expect(
      isActiveReadingState({
        userId: "user-a",
        articleId: "article-1",
        mode: "re_read",
      }),
    ).toBe(false);
    expect(isActiveReadingState({ broken: true })).toBe(false);
    expect(
      isActiveReadingState({
        userId: "user-a",
        articleId: "article-1",
        inboxId: 123,
        mode: "basic",
      }),
    ).toBe(false);
  });
});

describe("active reading storage ordering", () => {
  it("finishes an older save before a newer completion clear", async () => {
    const queue = createAsyncOperationQueue();
    const events: string[] = [];
    let releaseSave: (() => void) | undefined;
    let markSaveStarted: (() => void) | undefined;
    const saveBlocked = new Promise<void>((resolve) => {
      releaseSave = resolve;
    });
    const saveStarted = new Promise<void>((resolve) => {
      markSaveStarted = resolve;
    });

    const save = queue.enqueue(async () => {
      events.push("save-start");
      markSaveStarted?.();
      await saveBlocked;
      events.push("save-end");
    });
    const clear = queue.enqueue(async () => {
      events.push("clear");
    });

    await saveStarted;
    expect(events).toEqual(["save-start"]);
    releaseSave?.();
    await Promise.all([save, clear]);
    expect(events).toEqual(["save-start", "save-end", "clear"]);
  });

  it("continues processing clears after an earlier storage failure", async () => {
    const queue = createAsyncOperationQueue();
    const clear = vi.fn().mockResolvedValue(undefined);

    await expect(
      queue.enqueue(async () => {
        throw new Error("save failed");
      }),
    ).rejects.toThrow("save failed");
    await expect(queue.enqueue(clear)).resolves.toBeUndefined();
    expect(clear).toHaveBeenCalledTimes(1);
  });

  it.each(["set", "clear"])(
    "keeps a concurrent %s authoritative over an older restore read",
    async (operation) => {
      const queue = createAsyncOperationQueue();
      const revisions = createRevisionGuard();
      const restoreRevision = revisions.begin();
      let releaseRead: (() => void) | undefined;
      const readBlocked = new Promise<void>((resolve) => {
        releaseRead = resolve;
      });
      const restoreRead = queue.enqueue(async () => {
        await readBlocked;
      });

      revisions.invalidate();
      const laterWrite = queue.enqueue(async () => {
        // The concrete write differs for set/clear, but both must run after
        // the in-flight read and invalidate its captured revision.
        expect(operation === "set" || operation === "clear").toBe(true);
      });

      releaseRead?.();
      await Promise.all([restoreRead, laterWrite]);
      expect(revisions.isCurrent(restoreRevision)).toBe(false);
    },
  );
});