/**
 * Small, platform-agnostic helpers around the parts of Supabase Auth that
 * need explicit control on React Native. Keeping these helpers free of React
 * Native and Supabase imports makes the failure paths testable without native
 * modules.
 */

export interface SessionLike {
  access_token: string;
  expires_at?: number;
}

type AuthResult<T extends SessionLike> = {
  data: { session: T | null };
  error: unknown | null;
};

export interface NativeAuthFacade<T extends SessionLike> {
  getSession: () => Promise<AuthResult<T>>;
  refreshSession: () => Promise<AuthResult<T>>;
  signOut: (options: { scope: "local" }) => Promise<{ error: unknown | null }>;
}

export interface NativeSessionRestoreResult<T extends SessionLike> {
  session: T | null;
  /**
   * A transient refresh failure leaves the credentials in storage. Start the
   * foreground refresher so the SDK can retry without ever exposing the
   * expired access token to the API client.
   */
  shouldRetryRefresh: boolean;
}

const REFRESH_MARGIN_MS = 60_000;

/**
 * Supabase initializes as soon as its client is constructed. On native, keep
 * its storage adapter closed until AuthProvider has reached an active app
 * state, so that initialization cannot independently recover a stale session.
 */
export function createNativeStorageAccessGate() {
  let isOpen = false;

  return {
    open(): void {
      isOpen = true;
    },
    canAccess(): boolean {
      return isOpen;
    },
  };
}

export interface NativeSessionRestoreOptions {
  now?: number;
  canRefresh?: boolean | (() => boolean);
}

export type AuthSessionEvent =
  | "INITIAL_SESSION"
  | "SIGNED_IN"
  | "SIGNED_OUT"
  | "TOKEN_REFRESHED"
  | "USER_UPDATED"
  | "PASSWORD_RECOVERY"
  | (string & {});

export interface AuthSessionEventResult<T extends SessionLike> {
  accepted: boolean;
  session: T | null;
}

export interface RestoreDecision<T extends SessionLike> {
  accepted: boolean;
  restoreComplete: boolean;
  session: T | null;
}

export interface RestoreCompletionOptions {
  /**
   * A transient refresh failure leaves the stored session in place. The
   * subsequent foreground refresher may emit TOKEN_REFRESHED, which is safe to
   * accept after the explicit restore has rejected INITIAL_SESSION.
   */
  allowRefreshEvents?: boolean;
}

/**
 * Serializes the two asynchronous authorities that can write auth state:
 * native restore and Supabase auth events. Once a sign-in/sign-up operation
 * commits a decision, an older restore result can only mark itself complete;
 * it cannot replace that decision.
 */
export function createAuthSessionCoordinator<T extends SessionLike>() {
  let revision = 0;
  let restoreRevision: number | null = null;
  let restorePending = false;
  let restoreDecisionMade = false;
  let authOperationRevision: number | null = null;
  let hasAuthoritativeDecision = false;
  let blockAuthEventsUntilNextOperation = false;
  let currentSession: T | null = null;

  return {
    beginRestore(): number {
      const operation = ++revision;
      restoreRevision = operation;
      restorePending = true;
      restoreDecisionMade = false;
      return operation;
    },

    beginAuthOperation(): number {
      const operation = ++revision;
      authOperationRevision = operation;
      hasAuthoritativeDecision = false;
      blockAuthEventsUntilNextOperation = false;
      currentSession = null;
      return operation;
    },

    commitAuthOperation(operation: number, session: T | null): boolean {
      if (
        authOperationRevision !== operation ||
        revision !== operation
      ) {
        return false;
      }

      authOperationRevision = null;
      hasAuthoritativeDecision = true;
      blockAuthEventsUntilNextOperation = session === null;
      currentSession = session;
      return true;
    },

    completeRestore(
      operation: number,
      session: T | null,
      { allowRefreshEvents = false }: RestoreCompletionOptions = {},
    ): RestoreDecision<T> {
      if (restoreRevision !== operation) {
        return {
          accepted: false,
          restoreComplete: restorePending === false,
          session: currentSession,
        };
      }

      restorePending = false;
      restoreDecisionMade = true;

      // A later auth operation has already made the authoritative decision.
      // The restore still completes, but its result is stale by definition.
      if (revision !== operation || hasAuthoritativeDecision) {
        return {
          accepted: false,
          restoreComplete: true,
          session: currentSession,
        };
      }

      currentSession = session;
      blockAuthEventsUntilNextOperation =
        session === null && !allowRefreshEvents;
      return { accepted: true, restoreComplete: true, session };
    },

    receiveAuthEvent(
      event: AuthSessionEvent,
      session: T | null,
    ): AuthSessionEventResult<T> {
      if (
        authOperationRevision !== null ||
        restorePending ||
        blockAuthEventsUntilNextOperation
      ) {
        return { accepted: false, session: currentSession };
      }

      // INITIAL_SESSION is a replay of the SDK's persisted state. The
      // explicit restore or a just-completed auth operation is authoritative,
      // so a late INITIAL_SESSION event must not undo it.
      if (
        event === "INITIAL_SESSION" &&
        (restoreDecisionMade || hasAuthoritativeDecision)
      ) {
        return { accepted: false, session: currentSession };
      }

      if (event === "SIGNED_OUT") {
        hasAuthoritativeDecision = true;
      }
      currentSession = session;
      return { accepted: true, session };
    },

    markExplicitSignOut(): void {
      ++revision;
      authOperationRevision = null;
      hasAuthoritativeDecision = true;
      blockAuthEventsUntilNextOperation = true;
      currentSession = null;
    },

    isRestorePending(): boolean {
      return restorePending;
    },

    getCurrentSession(): T | null {
      return currentSession;
    },
  };
}

function errorName(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("name" in error)) {
    return null;
  }
  return typeof error.name === "string" ? error.name : null;
}

function errorStatus(error: unknown): number | null {
  if (typeof error !== "object" || error === null || !("status" in error)) {
    return null;
  }
  return typeof error.status === "number" ? error.status : null;
}

/**
 * Network/server failures should leave the stored session available for a
 * later retry. Invalid credentials and a missing refresh token are permanent,
 * so keeping them only makes every foreground refresh fail again.
 */
export function isNonRetryableRefreshError(error: unknown): boolean {
  const name = errorName(error);
  if (
    name === "AuthSessionMissingError" ||
    name === "AuthInvalidTokenResponseError"
  ) {
    return true;
  }

  const status = errorStatus(error);
  return (
    status !== null &&
    status >= 400 &&
    status < 500 &&
    status !== 408 &&
    status !== 429
  );
}

export function isAccessTokenUsable(
  session: SessionLike | null,
  now = Date.now(),
): session is SessionLike {
  return (
    !!session &&
    typeof session.access_token === "string" &&
    session.access_token.length > 0 &&
    typeof session.expires_at === "number" &&
    session.expires_at * 1000 > now
  );
}

function needsRefresh(session: SessionLike, now: number): boolean {
  return (
    typeof session.expires_at !== "number" ||
    session.expires_at * 1000 - now <= REFRESH_MARGIN_MS
  );
}

async function clearLocalSession<T extends SessionLike>(
  auth: NativeAuthFacade<T>,
): Promise<void> {
  // Local sign-out is deliberately used here: a refresh token that has
  // already rotated cannot be revoked remotely, while this still clears every
  // persisted local auth key and emits the signed-out event for AuthGuard.
  await auth.signOut({ scope: "local" }).catch(() => undefined);
}

/**
 * Restore a persisted native session without allowing the SDK's constructor
 * to perform an unhandled automatic refresh. A usable token is returned as
 * is; a near-expiry token is refreshed explicitly so invalid-refresh errors
 * can be handled as a normal logged-out state.
 */
export async function restoreNativeSession<T extends SessionLike>(
  auth: NativeAuthFacade<T>,
  { now = Date.now(), canRefresh = true }: NativeSessionRestoreOptions = {},
): Promise<NativeSessionRestoreResult<T>> {
  let current: AuthResult<T>;
  try {
    current = await auth.getSession();
  } catch {
    return { session: null, shouldRetryRefresh: false };
  }

  if (current.error) {
    if (isNonRetryableRefreshError(current.error)) {
      await clearLocalSession(auth);
      return { session: null, shouldRetryRefresh: false };
    }
    return { session: null, shouldRetryRefresh: true };
  }

  if (!current.data.session) {
    return { session: null, shouldRetryRefresh: false };
  }

  if (!needsRefresh(current.data.session, now)) {
    return { session: current.data.session, shouldRetryRefresh: false };
  }

  const canRefreshNow =
    typeof canRefresh === "function" ? canRefresh() : canRefresh;
  if (!canRefreshNow) {
    return { session: null, shouldRetryRefresh: true };
  }

  try {
    const refreshed = await auth.refreshSession();
    if (refreshed.error || !isAccessTokenUsable(refreshed.data.session, now)) {
      if (refreshed.error && isNonRetryableRefreshError(refreshed.error)) {
        await clearLocalSession(auth);
        return { session: null, shouldRetryRefresh: false };
      }

      // A successful response without a replacement session cannot be
      // recovered by retrying. Remove the old expired credentials rather than
      // leaving the next foreground tick to retry them forever.
      if (!refreshed.error) {
        await clearLocalSession(auth);
        return { session: null, shouldRetryRefresh: false };
      }

      return { session: null, shouldRetryRefresh: true };
    }

    return { session: refreshed.data.session, shouldRetryRefresh: false };
  } catch (error) {
    if (isNonRetryableRefreshError(error)) {
      await clearLocalSession(auth);
      return { session: null, shouldRetryRefresh: false };
    }
    return { session: null, shouldRetryRefresh: true };
  }
}

export interface NativeAutoRefreshFacade {
  startAutoRefresh: () => Promise<void>;
  stopAutoRefresh: () => Promise<void>;
}

/**
 * Supabase cannot determine React Native foreground state itself. This
 * controller starts its refresher only while the app is active and avoids
 * duplicate start/stop calls from repeated AppState events.
 */
export function createNativeAutoRefreshController(
  auth: NativeAutoRefreshFacade,
) {
  let isRunning = false;

  return {
    async setAppState(nextState: string | null): Promise<void> {
      const shouldRun = nextState === "active";
      if (shouldRun === isRunning) return;

      isRunning = shouldRun;
      try {
        if (shouldRun) {
          await auth.startAutoRefresh();
        } else {
          await auth.stopAutoRefresh();
        }
      } catch (error) {
        isRunning = !shouldRun;
        throw error;
      }
    },
    async stop(): Promise<void> {
      if (!isRunning) return;
      isRunning = false;
      await auth.stopAutoRefresh();
    },
  };
}

/**
 * Avoid even reading a persisted native session until React Native reports an
 * active app. This keeps the startup path from touching auth storage or any
 * SDK recovery behavior while the process is backgrounded.
 */
export function createActiveSessionRestoreGate(
  restore: () => Promise<void>,
) {
  let hasStarted = false;

  return {
    async setAppState(nextState: string | null): Promise<void> {
      if (nextState !== "active" || hasStarted) return;
      hasStarted = true;
      await restore();
    },
  };
}