import React, { createContext, useContext, useEffect, useState } from "react";
import { Session, AuthError } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { supabase } from "@/lib/supabase";

interface AuthContextValue {
  session: Session | null;
  isLoading: boolean;
  signInWithOtp: (email: string) => Promise<{ error: AuthError | null }>;
  verifyEmailOtp: (email: string, token: string) => Promise<{ error: AuthError | null }>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue>({
  session: null,
  isLoading: true,
  signInWithOtp: async () => ({ error: null }),
  verifyEmailOtp: async () => ({ error: null }),
  signOut: async () => {},
});

function extractTokensFromUrl(url: string): { accessToken: string | null; refreshToken: string | null } {
  try {
    const parsed = Linking.parse(url);
    const params = parsed.queryParams ?? {};
    let at = typeof params["access_token"] === "string" ? params["access_token"] : null;
    let rt = typeof params["refresh_token"] === "string" ? params["refresh_token"] : null;

    if (!at || !rt) {
      const hashIndex = url.indexOf("#");
      if (hashIndex !== -1) {
        const hashParams = new URLSearchParams(url.slice(hashIndex + 1));
        at = hashParams.get("access_token");
        rt = hashParams.get("refresh_token");
      }
    }
    return { accessToken: at, refreshToken: rt };
  } catch {
    return { accessToken: null, refreshToken: null };
  }
}

async function handleDeepLinkUrl(url: string): Promise<void> {
  const { accessToken, refreshToken } = extractTokensFromUrl(url);
  if (accessToken && refreshToken) {
    await supabase.auth.setSession({
      access_token: accessToken,
      refresh_token: refreshToken,
    });
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setIsLoading(false);
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
        setIsLoading(false);
      }
    );

    Linking.getInitialURL().then((url) => {
      if (url) handleDeepLinkUrl(url);
    });

    const linkingSub = Linking.addEventListener("url", ({ url }) => {
      handleDeepLinkUrl(url);
    });

    return () => {
      subscription.unsubscribe();
      linkingSub.remove();
    };
  }, []);

  async function signInWithOtp(email: string) {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        shouldCreateUser: true,
      },
    });
    return { error };
  }

  async function verifyEmailOtp(email: string, token: string) {
    const { error } = await supabase.auth.verifyOtp({
      email,
      token,
      type: "email",
    });
    return { error };
  }

  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  }

  return (
    <AuthContext.Provider value={{ session, isLoading, signInWithOtp, verifyEmailOtp, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  return useContext(AuthContext);
}
