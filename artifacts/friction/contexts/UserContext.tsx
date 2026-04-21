import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { customFetch } from "@workspace/api-client-react";

const FALLBACK_USER_ID = "00000000-0000-4000-a000-000000000001";

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
    customFetch("/api/users/sync", {
      method: "POST",
      body: JSON.stringify({ id, email }),
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
