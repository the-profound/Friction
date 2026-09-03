import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { Session, AuthError } from "@supabase/supabase-js";
import {
  activateNativeAuthStorage,
  supabase,
} from "@/lib/supabase";
import { getCurrentDevicePushToken } from "@/lib/usePushNotifications";
import {
  createActiveSessionRestoreGate,
  createAuthSessionCoordinator,
  createNativeAutoRefreshController,
  restoreNativeSession,
} from "@/lib/authSessionRecovery";
import { setCurrentAuthSession } from "@/lib/authTokenStore";
import { runtimeConfig } from "@/lib/runtimeConfig";
import {
  createAuthFlowId,
  probeApiReachability,
  reportAuthDiagnostic,
  type ApiReachability,
} from "@/lib/authDiagnostics";
import {
  getSignupAuthFailure,
  getSignupProfileSyncCode,
  getSignupProfileSyncFailure,
  getSignupTransitionFailure,
  getUnknownSignupFailure,
  isNetworkFailure,
  type SignupFailure,
} from "@/lib/signupDiagnostics";
import { customFetch } from "@workspace/api-client-react";

export type AuthFlowError = AuthError | { message: string; name: string };
export interface SignUpResult {
  error: SignupFailure | null;
  needsConfirmation: boolean;
  diagnosticId: string;
}

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  configurationError: string | null;
  apiReachability: ApiReachability;
  refreshAuthSession: () => Promise<Session | null>;
  signInWithPassword: (email: string, password: string) => Promise<{ error: AuthFlowError | null }>;
  signUp: (email: string, password: string, nickname: string) => Promise<SignUpResult>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  isLoading: true,
  configurationError: null,
  apiReachability: "checking",
  refreshAuthSession: async () => null,
  signInWithPassword: async () => ({ error: null }),
  signUp: async () => ({
    error: null,
    needsConfirmation: false,
    diagnosticId: createAuthFlowId(),
  }),
  signOut: async () => {},
});

async function syncUserProfile(
  session: Session,
  nickname: string | undefined,
  flowId: string,
): Promise<void> {
  const { id, email } = session.user;
  if (!email) {
    reportAuthDiagnostic("profile-sync", "failed", "SYNC_INVALID_REQUEST", flowId);
    throw {
      message: "인증된 계정 이메일을 확인하지 못했습니다.",
      name: "SYNC_INVALID_REQUEST",
    };
  }

  const rawNickname = nickname ?? session.user.user_metadata?.nickname;
  const normalizedNickname =
    typeof rawNickname === "string" && rawNickname.trim().length > 0
      ? rawNickname.trim()
      : undefined;

  reportAuthDiagnostic("profile-sync", "started", undefined, flowId);
  try {
    await customFetch("/api/users/sync", {
      method: "POST",
      headers: { "X-Auth-Flow-Id": flowId },
      body: JSON.stringify({
        id,
        email,
        ...(normalizedNickname ? { nickname: normalizedNickname } : {}),
      }),
    });
    reportAuthDiagnostic("profile-sync", "succeeded", undefined, flowId);
  } catch (error) {
    reportAuthDiagnostic("profile-sync", "failed", getSignupProfileSyncCode(error), flowId);
    throw error;
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [configurationError] = useState<string | null>(runtimeConfig.errorMessage);
  const [apiReachability, setApiReachability] = useState<ApiReachability>(
    Platform.OS === "web" ? "not-applicable" : "checking",
  );
  const nativeAutoRefreshRef = useRef<ReturnType<
    typeof createNativeAutoRefreshController
  > | null>(null);
  const refreshSessionPromiseRef = useRef<Promise<Session | null> | null>(null);
  const authCoordinatorRef = useRef(createAuthSessionCoordinator<Session>());

  // Supabase fires onAuthStateChange synchronously as part of
  // supabase.auth.signUp() *before* our own signUp() function below gets a
  // chance to run the /api/users/sync call. When auto-confirm is enabled
  // (no email verification), that means the app would flip to "authenticated"
  // and AuthGuard would redirect to the home tabs BEFORE the user's profile
  // row exists in the backend — stranding them on a broken screen. While a
  // signUp() call is in flight, we hold back applying its session update
  // until the profile sync has actually finished (success or failure), then
  // apply (or drop) it deliberately. See signUp() below.
  const suppressAuthEventsRef = useRef(false);
  // The Supabase INITIAL_SESSION event is emitted independently of our
  // explicit native validation. Until that validation is complete, accepting
  // it could briefly mount a protected route with an expired access token.
  const initialRestoreCompleteRef = useRef(false);
  // getSession() and onAuthStateChange() can both observe the auth session
  // while signUp() is waiting for /api/users/sync. Keep those observations
  // out of React state until signUp() has made the authoritative decision.
  const pendingAuthSessionRef = useRef<Session | null | undefined>(undefined);

  function applySession(nextSession: Session | null): void {
    setCurrentAuthSession(nextSession);
    setSession(nextSession);
  }

  const refreshAuthSession = useCallback(async (): Promise<Session | null> => {
    if (Platform.OS !== "web" && AppState.currentState !== "active") {
      return null;
    }

    if (refreshSessionPromiseRef.current) {
      return refreshSessionPromiseRef.current;
    }

    const refreshPromise = (async () => {
      try {
        const { data, error } = await supabase.auth.refreshSession();
        if (error || !data.session) return null;

        // Update the request token synchronously before the caller retries.
        // Supabase also emits TOKEN_REFRESHED, but waiting for React state
        // would leave a small window in which customFetch still sees the old
        // access token.
        applySession(data.session);
        return data.session;
      } catch {
        // Keep the current session for a later foreground retry. A transient
        // refresh failure must not turn a single sync failure into a logout.
        return null;
      }
    })();

    refreshSessionPromiseRef.current = refreshPromise;
    try {
      return await refreshPromise;
    } finally {
      if (refreshSessionPromiseRef.current === refreshPromise) {
        refreshSessionPromiseRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;
    setCurrentAuthSession(null);

    if (configurationError) {
      console.error("[auth] Invalid app configuration:", configurationError);
      reportAuthDiagnostic("config", "invalid-build", "RuntimeConfigError");
      initialRestoreCompleteRef.current = true;
      setIsLoading(false);
      return () => {
        mounted = false;
      };
    }

    const isNative = Platform.OS !== "web";
    const authCoordinator = authCoordinatorRef.current;
    const restoreOperation = authCoordinator.beginRestore();
    const autoRefresh = isNative
      ? createNativeAutoRefreshController(supabase.auth)
      : null;
    nativeAutoRefreshRef.current = autoRefresh;

    let unsubscribeAuthState: (() => void) | null = null;
    const subscribeToAuthEvents = (): void => {
      if (unsubscribeAuthState) return;
      const { data: { subscription } } = supabase.auth.onAuthStateChange(
        (event, nextSession) => {
          const decision = authCoordinator.receiveAuthEvent(event, nextSession);
          if (!decision.accepted) {
            pendingAuthSessionRef.current = nextSession;
            return;
          }
          applySession(decision.session);
          setIsLoading(false);
          reportAuthDiagnostic("auth-event", event);
        },
      );
      unsubscribeAuthState = () => subscription.unsubscribe();
    };

    const restoreSession = async (): Promise<void> => {
      try {
        // The SDK is constructed at module import time. Unlock its native
        // storage only from this active-state restore owner, before any
        // getSession() or refreshSession() call can reach SecureStore.
        if (isNative) activateNativeAuthStorage();
        // A rejected or indefinitely pending SecureStore read must not leave
        // AuthGuard in its full-screen loading state forever.
        const result = await Promise.race([
          isNative
            ? restoreNativeSession(supabase.auth, {
                canRefresh: () => AppState.currentState === "active",
              })
            : supabase.auth.getSession().then((result) => ({
                session: result.data.session,
                shouldRetryRefresh: false,
              })),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("Supabase session restore timed out")),
              10000,
            );
          }),
        ]);

        if (!mounted) return;
        const pendingSession = pendingAuthSessionRef.current;
        // Native restoration is authoritative because it explicitly validates
        // a near-expiry refresh token. On web, preserve the SDK's hydrated
        // INITIAL_SESSION if a concurrent direct read returned null.
        const restoredSession =
          result.session ??
          (!isNative && pendingSession !== undefined ? pendingSession : null);
        const restoreDecision = authCoordinator.completeRestore(
          restoreOperation,
          restoredSession,
          { allowRefreshEvents: result.shouldRetryRefresh },
        );
        if (restoreDecision.accepted && !suppressAuthEventsRef.current) {
          applySession(restoreDecision.session);
        }
        pendingAuthSessionRef.current = undefined;
        // Set this after the explicit session decision so an event already
        // queued by the refresh cannot overwrite it with an older session.
        initialRestoreCompleteRef.current = restoreDecision.restoreComplete;
        // Native onAuthStateChange emits INITIAL_SESSION by reading its storage.
        // Register it only after our active-state restore has resolved the
        // persisted credentials, then let foreground auto-refresh emit only
        // post-restore changes through this subscription.
        if (isNative) subscribeToAuthEvents();
        const currentSession = authCoordinator.getCurrentSession();
        if (
          isNative &&
          (restoreDecision.accepted
            ? Boolean(currentSession || result.shouldRetryRefresh)
            : Boolean(currentSession))
        ) {
          void autoRefresh?.setAppState(AppState.currentState).catch(() => undefined);
        }
        reportAuthDiagnostic(
          "restore",
          restoreDecision.accepted
            ? currentSession
              ? "authenticated"
              : result.shouldRetryRefresh
                ? "retryable-failure"
                : "logged-out"
            : "stale-result-ignored",
        );
      } catch (error) {
        if (!mounted) return;
        // Treat an unavailable storage/auth service as logged out. In
        // particular, never forward refresh-token failures to LogBox.
        const restoreDecision = authCoordinator.completeRestore(
          restoreOperation,
          null,
        );
        initialRestoreCompleteRef.current = restoreDecision.restoreComplete;
        if (restoreDecision.accepted && !suppressAuthEventsRef.current) {
          applySession(null);
        }
        if (isNative) subscribeToAuthEvents();
        reportAuthDiagnostic(
          "restore",
          restoreDecision.accepted ? "failed-logged-out" : "stale-failure-ignored",
          isNetworkFailure(error) ? "NetworkError" : "AuthRestoreError",
        );
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (mounted && !suppressAuthEventsRef.current) {
          setIsLoading(false);
        }
      }
    };

    const restoreGate = createActiveSessionRestoreGate(restoreSession);

    const appStateSubscription = isNative
      ? AppState.addEventListener("change", (nextState) => {
          void restoreGate.setAppState(nextState).catch(() => undefined);
          if (!initialRestoreCompleteRef.current) return;
          void autoRefresh?.setAppState(nextState).catch(() => undefined);
        })
      : null;

    if (isNative) {
      void restoreGate.setAppState(AppState.currentState).catch(() => undefined);
    } else {
      subscribeToAuthEvents();
      void restoreSession();
    }

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      appStateSubscription?.remove();
      void autoRefresh?.stop().catch(() => undefined);
      if (nativeAutoRefreshRef.current === autoRefresh) {
        nativeAutoRefreshRef.current = null;
      }
      unsubscribeAuthState?.();
    };
  }, []);

  useEffect(() => {
    if (
      Platform.OS === "web" ||
      !initialRestoreCompleteRef.current ||
      !nativeAutoRefreshRef.current
    ) {
      return;
    }

    if (session) {
      void nativeAutoRefreshRef.current
        .setAppState(AppState.currentState)
        .catch(() => undefined);
    } else {
      void nativeAutoRefreshRef.current.stop().catch(() => undefined);
    }
  }, [session]);

  useEffect(() => {
    if (configurationError || Platform.OS === "web") return;
    let mounted = true;
    void probeApiReachability().then((result) => {
      if (mounted) setApiReachability(result);
    });
    return () => {
      mounted = false;
    };
  }, [configurationError]);

  async function signInWithPassword(email: string, password: string) {
    const flowId = createAuthFlowId();
    const authCoordinator = authCoordinatorRef.current;
    const operation = authCoordinator.beginAuthOperation();
    suppressAuthEventsRef.current = true;
    pendingAuthSessionRef.current = undefined;
    setCurrentAuthSession(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        authCoordinator.commitAuthOperation(operation, null);
         reportAuthDiagnostic("sign-in", "failed", isNetworkFailure(error) ? "NetworkError" : "AuthSignInError", flowId);
        return { error };
      }

      setCurrentAuthSession(data.session);
      reportAuthDiagnostic("sign-in", "auth-succeeded", undefined, flowId);
      try {
         await syncUserProfile(data.session, undefined, flowId);
      } catch (syncError) {
        authCoordinator.commitAuthOperation(operation, null);
        await supabase.auth.signOut().catch(() => {});
        setCurrentAuthSession(null);
        return {
          error: {
            message: getSignupProfileSyncFailure(syncError, flowId).message,
            name: "UserSyncError",
          },
        };
      }

      if (!authCoordinator.commitAuthOperation(operation, data.session)) {
        return {
          error: {
            message: "로그인 상태를 확정하지 못했습니다. 다시 시도해주세요.",
            name: "AuthTransitionError",
          } as AuthError,
        };
      }
      applySession(data.session);
      setIsLoading(false);
       reportAuthDiagnostic("sign-in", "success", undefined, flowId);
      return { error: null };
    } catch (error) {
      authCoordinator.commitAuthOperation(operation, null);
       reportAuthDiagnostic("sign-in", "failed", isNetworkFailure(error) ? "NetworkError" : "AuthSignInError", flowId);
      throw error;
    } finally {
      pendingAuthSessionRef.current = undefined;
      suppressAuthEventsRef.current = false;
      setIsLoading(false);
    }
  }

  async function signUp(email: string, password: string, nickname: string) {
    const flowId = createAuthFlowId();
    const authCoordinator = authCoordinatorRef.current;
    const operation = authCoordinator.beginAuthOperation();
    suppressAuthEventsRef.current = true;
    pendingAuthSessionRef.current = undefined;
    setCurrentAuthSession(null);
    try {
      let signUpResponse: Awaited<ReturnType<typeof supabase.auth.signUp>>;
      try {
        signUpResponse = await supabase.auth.signUp({
          email,
          password,
          options: { data: { nickname } },
        });
      } catch (error) {
        authCoordinator.commitAuthOperation(operation, null);
        const failure = getSignupAuthFailure(error, flowId);
        reportAuthDiagnostic("sign-up", "failed", failure.code, flowId);
        return { error: failure, needsConfirmation: false, diagnosticId: flowId };
      }
      const { data, error } = signUpResponse;
      if (error) {
        authCoordinator.commitAuthOperation(operation, null);
        const failure = getSignupAuthFailure(error, flowId);
        reportAuthDiagnostic("sign-up", "failed", failure.code, flowId);
        return { error: failure, needsConfirmation: false, diagnosticId: flowId };
      }
      const needsConfirmation = !data.session;
      reportAuthDiagnostic(
        "sign-up",
        needsConfirmation
          ? "auth-succeeded-confirmation-required"
          : "auth-succeeded-auto-confirmed",
        undefined,
        flowId,
      );

      // The profile sync request requires the newly-issued bearer token, but
      // React auth state remains suppressed until that sync has succeeded.
      if (data.session) setCurrentAuthSession(data.session);

      if (data.user && data.session) {
        try {
           await syncUserProfile(data.session, nickname, flowId);
        } catch (syncError) {
          authCoordinator.commitAuthOperation(operation, null);
          if (data.session) {
            // The account was auto-confirmed (session already created) but the
            // profile row failed to sync. Sign out immediately so the app never
            // treats this as a fully signed-in user with no profile — surface a
            // clear, retryable error on the signup screen instead.
            await supabase.auth.signOut().catch(() => {});
            setCurrentAuthSession(null);
          }
          const failure = getSignupProfileSyncFailure(syncError, flowId);
          reportAuthDiagnostic("sign-up", "failed", failure.code, flowId);
          return {
            error: failure,
            needsConfirmation,
            diagnosticId: flowId,
          };
        }
      }

      // Only now — after the profile sync has succeeded — do we let the app
      // see this session and treat the user as authenticated.
      if (!authCoordinator.commitAuthOperation(operation, data.session)) {
        const failure = getSignupTransitionFailure(flowId);
        reportAuthDiagnostic("sign-up", "failed", failure.code, flowId);
        return {
          error: failure,
          needsConfirmation,
          diagnosticId: flowId,
        };
      }
      if (data.session) {
        applySession(data.session);
        setIsLoading(false);
         reportAuthDiagnostic("sign-up", "success-auto-confirmed", undefined, flowId);
      } else {
        // Keep the login screen renderable when email confirmation is
        // required, even if initial session restoration was still pending.
        applySession(null);
        setIsLoading(false);
         reportAuthDiagnostic("sign-up", "confirmation-required", undefined, flowId);
      }
      return { error: null, needsConfirmation, diagnosticId: flowId };
    } catch (error) {
      authCoordinator.commitAuthOperation(operation, null);
      const failure = getUnknownSignupFailure(flowId);
      reportAuthDiagnostic("sign-up", "failed", failure.code, flowId);
      return { error: failure, needsConfirmation: false, diagnosticId: flowId };
    } finally {
      // The deliberate session decision above is authoritative. Discard
      // session observations collected while profile sync was in flight so a
      // stale getSession() result cannot re-authenticate the app prematurely.
      pendingAuthSessionRef.current = undefined;
      suppressAuthEventsRef.current = false;
      setIsLoading(false);
    }
  }

  async function signOut() {
    authCoordinatorRef.current.markExplicitSignOut();
    applySession(null);
    const token = getCurrentDevicePushToken();
    if (token) {
      try {
        await customFetch("/api/push-tokens", {
          method: "DELETE",
          body: JSON.stringify({ token }),
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        console.warn("[signOut] Failed to delete push token:", err);
      }
    }
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  return (
    <AuthContext.Provider
      value={{
        session,
        isLoading,
        configurationError,
        apiReachability,
        refreshAuthSession,
        signInWithPassword,
        signUp,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
