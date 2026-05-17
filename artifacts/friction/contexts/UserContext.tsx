import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { customFetch } from "@workspace/api-client-react";

interface UserContextValue {
  userId: string;
  nickname: string | undefined;
}

const UserContext = createContext<UserContextValue | null>(null);

export function UserProvider({
  children,
  userId: overrideUserId,
}: {
  children: React.ReactNode;
  userId?: string;
}) {
  const { session } = useAuth();
  const { showToast } = useToast();
  const syncedIdRef = useRef<string | null>(null);
  const syncErrorShownRef = useRef(false);

  const sessionUserId = session?.user?.id;
  const resolvedUserId = overrideUserId ?? sessionUserId;

  if (!resolvedUserId) {
    throw new Error(
      "UserProvider rendered without a userId. " +
        "Render UserProvider only after the auth session is loaded, " +
        "or pass an explicit `userId` prop (e.g. for tests).",
    );
  }

  useEffect(() => {
    if (overrideUserId) return;
    const id = session?.user?.id;
    const email = session?.user?.email;
    if (!id || !email) return;
    if (syncedIdRef.current === id) return;

    syncedIdRef.current = id;
    const rawNickname = session?.user?.user_metadata?.nickname;
    const nickname =
      typeof rawNickname === "string" && rawNickname.trim().length > 0
        ? rawNickname
        : undefined;

    customFetch("/api/users/sync", {
      method: "POST",
      body: JSON.stringify({ id, email, ...(nickname ? { nickname } : {}) }),
    })
      .then(() => {
        syncErrorShownRef.current = false;
      })
      .catch((err: unknown) => {
        // Reset so the next session change retries instead of staying silently broken.
        syncedIdRef.current = null;
        let detail: string;
        if (err && typeof err === "object") {
          const obj = err as {
            status?: unknown;
            statusText?: unknown;
            data?: unknown;
            message?: unknown;
          };
          if (typeof obj.status === "number") {
            detail = `${obj.status} ${obj.statusText ?? ""} ${JSON.stringify(obj.data ?? null)}`;
          } else if (typeof obj.message === "string") {
            detail = obj.message;
          } else {
            detail = String(err);
          }
        } else {
          detail = String(err);
        }
        // Detailed diagnostic only goes to the console — operators get a
        // short, friendly toast (one per session-change) so they notice
        // their account is not fully synced, without exposing raw payloads.
        console.warn(`[UserProvider] /api/users/sync failed for ${id}: ${detail}`);
        if (!syncErrorShownRef.current) {
          syncErrorShownRef.current = true;
          showToast({
            type: "error",
            message: "계정 동기화에 실패했어요. 잠시 후 다시 시도해주세요.",
          });
        }
      });
  }, [session, overrideUserId, showToast]);

  const resolvedNickname = overrideUserId
    ? undefined
    : (() => {
        const raw = session?.user?.user_metadata?.nickname;
        return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : undefined;
      })();

  const value = useMemo(
    () => ({ userId: resolvedUserId, nickname: resolvedNickname }),
    [resolvedUserId, resolvedNickname],
  );

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  );
}

export function useUser(): UserContextValue {
  const ctx = useContext(UserContext);
  if (!ctx) {
    throw new Error("useUser must be used inside <UserProvider>.");
  }
  return ctx;
}
