import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { customFetch } from "@workspace/api-client-react";

const FALLBACK_USER_ID = "92d8bf9b-e5f0-46aa-834c-c9bb66d7a83f";

interface UserContextValue {
  userId: string;
}

const UserContext = createContext<UserContextValue>({ userId: FALLBACK_USER_ID });

export function UserProvider({
  children,
  userId: overrideUserId,
}: {
  children: React.ReactNode;
  userId?: string;
}) {
  const { session } = useAuth();
  const syncedIdRef = useRef<string | null>(null);

  const userId = overrideUserId ?? session?.user?.id ?? FALLBACK_USER_ID;

  useEffect(() => {
    const id = session?.user?.id;
    const email = session?.user?.email;
    if (!id || !email) return;
    if (syncedIdRef.current === id) return;

    syncedIdRef.current = id;
    const rawNickname = session?.user?.user_metadata?.nickname;
    const nickname = typeof rawNickname === "string" && rawNickname.trim().length > 0 ? rawNickname : undefined;
    customFetch("/api/users/sync", {
      method: "POST",
      body: JSON.stringify({ id, email, ...(nickname ? { nickname } : {}) }),
    }).catch(() => {});
  }, [session]);

  const value = useMemo(() => ({ userId }), [userId]);

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  return useContext(UserContext);
}
