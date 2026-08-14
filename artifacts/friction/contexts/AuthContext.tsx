import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Session, AuthError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { customFetch } from "@workspace/api-client-react";
import { getCurrentDevicePushToken } from "@/lib/usePushNotifications";

export type SignUpError = AuthError | { message: string; name: string };

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  signInWithPassword: (email: string, password: string) => Promise<{ error: AuthError | null }>;
  signUp: (email: string, password: string, nickname: string) => Promise<{ error: SignUpError | null; needsConfirmation: boolean }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  isLoading: true,
  signInWithPassword: async () => ({ error: null }),
  signUp: async () => ({ error: null, needsConfirmation: false }),
  signOut: async () => {},
});

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

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
  // getSession() and onAuthStateChange() can both observe the auth session
  // while signUp() is waiting for /api/users/sync. Keep those observations
  // out of React state until signUp() has made the authoritative decision.
  const pendingAuthSessionRef = useRef<Session | null | undefined>(undefined);

  useEffect(() => {
    let mounted = true;
    let timeoutId: ReturnType<typeof setTimeout> | undefined;

    const restoreSession = async (): Promise<void> => {
      try {
        // A rejected or indefinitely pending SecureStore read must not leave
        // AuthGuard in its full-screen loading state forever.
        const result = await Promise.race([
          supabase.auth.getSession(),
          new Promise<never>((_, reject) => {
            timeoutId = setTimeout(
              () => reject(new Error("Supabase session restore timed out")),
              10000,
            );
          }),
        ]);

        if (!mounted) return;
        const restoredSession = result.data.session;
        if (suppressAuthEventsRef.current) {
          pendingAuthSessionRef.current = restoredSession;
          return;
        }
        setSession(restoredSession);
      } catch (error) {
        if (!mounted) return;
        console.warn("[AuthProvider] Initial session restore failed:", error);
        if (!suppressAuthEventsRef.current) {
          setSession(null);
        }
      } finally {
        if (timeoutId) clearTimeout(timeoutId);
        if (mounted && !suppressAuthEventsRef.current) {
          setIsLoading(false);
        }
      }
    };

    void restoreSession();

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (suppressAuthEventsRef.current) {
          pendingAuthSessionRef.current = session;
          return;
        }
        setSession(session);
        setIsLoading(false);
      }
    );

    return () => {
      mounted = false;
      if (timeoutId) clearTimeout(timeoutId);
      subscription.unsubscribe();
    };
  }, []);

  async function signInWithPassword(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function signUp(email: string, password: string, nickname: string) {
    suppressAuthEventsRef.current = true;
    pendingAuthSessionRef.current = undefined;
    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password,
        options: { data: { nickname } },
      });
      if (error) {
        return { error, needsConfirmation: false };
      }
      const needsConfirmation = !data.session;

      if (data.user) {
        try {
          await customFetch("/api/users/sync", {
            method: "POST",
            body: JSON.stringify({ id: data.user.id, email, nickname }),
          });
        } catch {
          if (data.session) {
            // The account was auto-confirmed (session already created) but the
            // profile row failed to sync. Sign out immediately so the app never
            // treats this as a fully signed-in user with no profile — surface a
            // clear, retryable error on the signup screen instead.
            await supabase.auth.signOut().catch(() => {});
          }
          return {
            error: { message: "사용자 정보 저장에 실패했습니다. 다시 시도해주세요.", name: "UserSyncError" },
            needsConfirmation,
          };
        }
      }

      // Only now — after the profile sync has succeeded — do we let the app
      // see this session and treat the user as authenticated.
      if (data.session) {
        setSession(data.session);
        setIsLoading(false);
      } else {
        // Keep the login screen renderable when email confirmation is
        // required, even if initial session restoration was still pending.
        setSession(null);
        setIsLoading(false);
      }
      return { error: null, needsConfirmation };
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
    <AuthContext.Provider value={{ session, isLoading, signInWithPassword, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
