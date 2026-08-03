import React, { createContext, useContext, useEffect, useRef, useState } from "react";
import { Session, AuthError } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";
import { customFetch } from "@workspace/api-client-react";

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

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        if (suppressAuthEventsRef.current) return;
        setSession(session);
        setIsLoading(false);
      }
    );

    return () => {
      subscription.unsubscribe();
    };
  }, []);

  async function signInWithPassword(email: string, password: string) {
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    return { error };
  }

  async function signUp(email: string, password: string, nickname: string) {
    suppressAuthEventsRef.current = true;
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
      }
      return { error: null, needsConfirmation };
    } finally {
      suppressAuthEventsRef.current = false;
    }
  }

  async function signOut() {
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
