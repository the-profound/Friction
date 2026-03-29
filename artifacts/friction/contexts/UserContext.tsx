import React, { createContext, useContext, useMemo } from "react";
import Constants from "expo-constants";

interface UserContextValue {
  userId: string;
}

function resolveUserId(): string {
  const envId = Constants.expoConfig?.extra?.userId;
  if (typeof envId === "string" && envId.length > 0) return envId;
  return "00000000-0000-4000-a000-000000000001";
}

const defaultUserId = resolveUserId();
const UserContext = createContext<UserContextValue>({ userId: defaultUserId });

export function UserProvider({
  children,
  userId: overrideUserId,
}: {
  children: React.ReactNode;
  userId?: string;
}) {
  const value = useMemo(
    () => ({ userId: overrideUserId ?? defaultUserId }),
    [overrideUserId],
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
