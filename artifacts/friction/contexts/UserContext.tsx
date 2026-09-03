import React, { createContext, useContext, useEffect, useMemo, useRef } from "react";
import { AppState } from "react-native";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/contexts/ToastContext";
import { isSpaceJoinContextQueryKey } from "@/lib/spaceJoinContextQuery";
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
  const { session, refreshAuthSession } = useAuth();
  const { showToast } = useToast();
  const queryClient = useQueryClient();
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

  const previousUserIdRef = useRef<string | undefined>(undefined);
  useEffect(() => {
    if (previousUserIdRef.current !== resolvedUserId) {
      queryClient.removeQueries({
        predicate: (query) => isSpaceJoinContextQueryKey(query.queryKey),
      });
      previousUserIdRef.current = resolvedUserId;
    }
  }, [queryClient, resolvedUserId]);

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
    let cancelled = false;
    const syncRequest = () =>
      customFetch("/api/users/sync", {
        method: "POST",
        headers: { "X-Auth-Flow-Id": flowId },
        body: JSON.stringify({ id, email, ...(nickname ? { nickname } : {}) }),
      });

    (async () => {
      try {
        await syncRequest();
        syncErrorShownRef.current = false;
        return;
      } catch (err: unknown) {
        const code =
          err instanceof ApiError &&
          err.data &&
          typeof err.data === "object" &&
          typeof (err.data as { code?: unknown }).code === "string"
            ? (err.data as { code: string }).code
            : "SYNC_UNKNOWN";

        // An access token can still look locally unexpired after Supabase
        // has rotated or revoked it server-side. Refresh once and retry the
        // profile sync with the newly-issued token before showing an error.
        if (code === "AUTH_INVALID" && AppState.currentState === "active") {
          const refreshedSession = await refreshAuthSession();
          if (
            refreshedSession?.user.id === id &&
            refreshedSession.user.email === email
          ) {
            try {
              await syncRequest();
              syncErrorShownRef.current = false;
              return;
            } catch (retryError: unknown) {
              err = retryError;
            }
          }
        }

        // Reset so the next session change retries instead of staying silently broken.
        syncedIdRef.current = null;
        const finalCode =
          err instanceof ApiError &&
          err.data &&
          typeof err.data === "object" &&
          typeof (err.data as { code?: unknown }).code === "string"
            ? (err.data as { code: string }).code
            : "SYNC_UNKNOWN";
        reportAuthDiagnostic("profile-sync", "failed-background", finalCode as Parameters<typeof reportAuthDiagnostic>[2], flowId);
        // Keep operator evidence anonymous: account identifiers, request
        // payloads, response bodies, and raw exception messages are omitted.
        console.warn(`[UserProvider] /api/users/sync failed (${finalCode}; flow=${flowId})`);
        if (!cancelled && !syncErrorShownRef.current) {
          syncErrorShownRef.current = true;
          showToast({
            type: "error",
            message: "계정 동기화에 실패했어요. 잠시 후 다시 시도해주세요.",
          });
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [session, overrideUserId, refreshAuthSession, showToast]);

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
