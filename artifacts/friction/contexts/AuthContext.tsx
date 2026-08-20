import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { AppState, Platform } from "react-native";
import { Session, AuthError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { customFetch } from "@workspace/api-client-react";
import { getCurrentDevicePushToken } from "@/lib/usePushNotifications";
import {
  createActiveSessionRestoreGate,
  createAuthSessionCoordinator,
  createNativeAutoRefreshController,
  restoreNativeSession,
} from "@/lib/authSessionRecovery";
import { setCurrentAuthSession } from "@/lib/authTokenStore";
import { runtimeConfig } from "@/lib/runtimeConfig";
import { reportAuthDiagnostic } from "@/lib/authDiagnostics";

export type SignUpError = AuthError | { message: string; name: string };
export type AuthFlowError = AuthError | { message: string; name: string };

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  configurationError: string | null;
  signInWithPassword: (email: string, password: string) => Promise<{ error: AuthFlowError | null }>;
  signUp: (email: string, password: string, nickname: string) => Promise<{ error: SignUpError | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  isLoading: true,
  configurationError: null,
  signInWithPassword: async () => ({ error: null }),
  signUp: async () => ({ error: null, needsConfirmation: false }),
  signOut: async () => {},
});

function isNetworkFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    const message = String(error).toLowerCase();
    return (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("timeout") ||
      message.includes("abort")
    );
  }

  const candidate = error as { name?: unknown; message?: unknown; status?: unknown };
  const name = typeof candidate.name === "string" ? candidate.name.toLowerCase() : "";
  const message =
    typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
  const status = typeof candidate.status === "number" ? candidate.status : null;

  return (
    name.includes("network") ||
    name.includes("fetch") ||
    name.includes("abort") ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("timeout") ||
    message.includes("abort") ||
    status === 0 ||
    status === 408 ||
    status === 429 ||
    (status !== null && status >= 500)
  );
}

async function syncUserProfile(session: Session, nickname?: string): Promise<void> {
  const { id, email } = session.user;
  if (!email) {
    throw {
      message: "인증된 계정 이메일을 확인하지 못했습니다.",
      name: "UserSyncError",
    } satisfies SignUpError;
  }

  const rawNickname = nickname ?? session.user.user_metadata?.nickname;
  const normalizedNickname =
    typeof rawNickname === "string" && rawNickname.trim().length > 0
      ? rawNickname.trim()
      : undefined;

  await customFetch("/api/users/sync", {
    method: "POST",
    body: JSON.stringify({
      id,
      email,
      ...(normalizedNickname ? { nickname: normalizedNickname } : {}),
    }),
  });
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [configurationError] = useState<string | null>(runtimeConfig.errorMessage);
  const nativeAutoRefreshRef = useRef<ReturnType<
    typeof createNativeAutoRefreshController
  > | null>(null);
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

    const restoreSession = async (): Promise<void> => {
      try {
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
        );
        if (restoreDecision.accepted && !suppressAuthEventsRef.current) {
          applySession(restoreDecision.session);
        }
        pendingAuthSessionRef.current = undefined;
        // Set this after the explicit session decision so an event already
        // queued by the refresh cannot overwrite it with an older session.
        initialRestoreCompleteRef.current = restoreDecision.restoreComplete;
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
      void restoreSession();
    }

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (event, session) => {
        const decision = authCoordinator.receiveAuthEvent(event, session);
        if (!decision.accepted) {
          pendingAuthSessionRef.current = session;
          return;
        }
        applySession(decision.session);
        setIsLoading(false);
        reportAuthDiagnostic("auth-event", event);
      }
    );

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      appStateSubscription?.remove();
      void autoRefresh?.stop().catch(() => undefined);
      if (nativeAutoRefreshRef.current === autoRefresh) {
        nativeAutoRefreshRef.current = null;
      }
      subscription.unsubscribe();
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

  async function signInWithPassword(email: string, password: string) {
    const authCoordinator = authCoordinatorRef.current;
    const operation = authCoordinator.beginAuthOperation();
    suppressAuthEventsRef.current = true;
    pendingAuthSessionRef.current = undefined;
    setCurrentAuthSession(null);

    try {
      const { data, error } = await supabase.auth.signInWithPassword({ email, password });
      if (error) {
        authCoordinator.commitAuthOperation(operation, null);
        reportAuthDiagnostic(
          "sign-in",
          "failed",
          isNetworkFailure(error) ? "NetworkError" : error.name,
        );
        return { error };
      }

      setCurrentAuthSession(data.session);
      try {
        await syncUserProfile(data.session);
      } catch (syncError) {
        authCoordinator.commitAuthOperation(operation, null);
        await supabase.auth.signOut().catch(() => {});
        setCurrentAuthSession(null);
        reportAuthDiagnostic(
          "profile-sync",
          "failed-during-sign-in",
          isNetworkFailure(syncError) ? "NetworkError" : "UserSyncError",
        );
        return {
          error: {
            message: isNetworkFailure(syncError)
              ? "네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요."
              : "사용자 정보 저장에 실패했습니다. 다시 시도해주세요.",
            name: isNetworkFailure(syncError)
              ? "UserSyncNetworkError"
              : "UserSyncError",
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
      reportAuthDiagnostic("sign-in", "success");
      return { error: null };
    } catch (error) {
      authCoordinator.commitAuthOperation(operation, null);
      reportAuthDiagnostic(
        "sign-in",
        "failed",
        isNetworkFailure(error) ? "NetworkError" : "AuthSignInError",
      );
      throw error;
    } finally {
      pendingAuthSessionRef.current = undefined;
      suppressAuthEventsRef.current = false;
      setIsLoading(false);
    }
  }

  async function signUp(email: string, password: string, nickname: string) {
    const authCoordinator = authCoordinatorRef.current;
    const operation = authCoordinator.beginAuthOperation();
    suppressAuthEventsRef.current = true;
    pendingAuthSessionRef.current = undefined;
    setCurrentAuthSession(null);
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { nickname } },
      });
      if (error) {
        authCoordinator.commitAuthOperation(operation, null);
        reportAuthDiagnostic(
          "sign-up",
          "failed",
          isNetworkFailure(error) ? "NetworkError" : error.name,
        );
        return { error, needsConfirmation: false };
      }
      const needsConfirmation = !data.session;

      // The profile sync request requires the newly-issued bearer token, but
      // React auth state remains suppressed until that sync has succeeded.
      if (data.session) setCurrentAuthSession(data.session);

      if (data.user && data.session) {
        try {
          await syncUserProfile(data.session, nickname);
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
          reportAuthDiagnostic(
            "profile-sync",
            "failed",
            isNetworkFailure(syncError) ? "NetworkError" : "UserSyncError",
          );
          return {
            error: {
              message: isNetworkFailure(syncError)
                ? "네트워크 오류가 발생했습니다. 인터넷 연결을 확인해주세요."
                : "사용자 정보 저장에 실패했습니다. 다시 시도해주세요.",
              name: isNetworkFailure(syncError)
                ? "UserSyncNetworkError"
                : "UserSyncError",
            },
            needsConfirmation,
          };
        }
      }

      // Only now — after the profile sync has succeeded — do we let the app
      // see this session and treat the user as authenticated.
      if (!authCoordinator.commitAuthOperation(operation, data.session)) {
        return {
          error: {
            message: "가입 상태를 확정하지 못했습니다. 다시 시도해주세요.",
            name: "AuthTransitionError",
          },
          needsConfirmation,
        };
      }
      if (data.session) {
        applySession(data.session);
        setIsLoading(false);
        reportAuthDiagnostic("sign-up", "success-auto-confirmed");
      } else {
        // Keep the login screen renderable when email confirmation is
        // required, even if initial session restoration was still pending.
        applySession(null);
        setIsLoading(false);
        reportAuthDiagnostic("sign-up", "confirmation-required");
      }
      return { error: null, needsConfirmation };
    } catch (error) {
      authCoordinator.commitAuthOperation(operation, null);
      reportAuthDiagnostic(
        "sign-up",
        "failed",
        isNetworkFailure(error) ? "NetworkError" : "AuthSignUpError",
      );
      throw error;
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
