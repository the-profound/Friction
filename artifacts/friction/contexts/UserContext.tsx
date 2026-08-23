import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { customFetch } from "@workspace/api-client-react";
import { ApiError } from "@workspace/api-client-react";
import { createAuthFlowId, reportAuthDiagnostic } from "@/lib/authDiagnostics";

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

    const flowId = createAuthFlowId();
    customFetch("/api/users/sync", {
      method: "POST",
      headers: { "X-Auth-Flow-Id": flowId },
      body: JSON.stringify({ id, email, ...(nickname ? { nickname } : {}) }),
    })
      .then(() => {
        syncErrorShownRef.current = false;
      })
      .catch((err: unknown) => {
        // Reset so the next session change retries instead of staying silently broken.
        syncedIdRef.current = null;
        const code =
          err instanceof ApiError &&
          err.data &&
          typeof err.data === "object" &&
          typeof (err.data as { code?: unknown }).code === "string"
            ? (err.data as { code: string }).code
            : "SYNC_UNKNOWN";
        reportAuthDiagnostic("profile-sync", "failed-background", code as Parameters<typeof reportAuthDiagnostic>[2], flowId);
        // Keep operator evidence anonymous: account identifiers, request
        // payloads, response bodies, and raw exception messages are omitted.
        console.warn(`[UserProvider] /api/users/sync failed (${code}; flow=${flowId})`);
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
