import React, { createContext, useContext } from "react";

interface UserContextValue {
  userId: string;
}

const DEMO_USER_ID = "demo-user-001";

const UserContext = createContext<UserContextValue>({ userId: DEMO_USER_ID });

export function UserProvider({ children }: { children: React.ReactNode }) {
  return (
    <UserContext.Provider value={{ userId: DEMO_USER_ID }}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  return useContext(UserContext);
}
