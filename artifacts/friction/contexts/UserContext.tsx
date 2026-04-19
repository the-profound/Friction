import React, { createContext, useContext, useMemo } from "react";
import { useAuth } from "@/contexts/AuthContext";

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

  const value = useMemo(
    () => ({ userId: overrideUserId ?? session?.user?.id ?? FALLBACK_USER_ID }),
    [overrideUserId, session],
  );

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  return useContext(UserContext);
}
