import type { QueryClient, QueryKey } from "@tanstack/react-query";
import { onlineManager } from "@tanstack/react-query";
import {
  listInbox,
  getListInboxQueryKey,
  listSpaces,
  getListSpacesQueryKey,
  listMySpaceInvitations,
  getListMySpaceInvitationsQueryKey,
  listMySpaceCodeRequests,
  getListMySpaceCodeRequestsQueryKey,
  listOperatorPendingSpaceCodeRequests,
  listMyCollections,
  getListMyCollectionsQueryKey,
  listStoredSentences,
  getListStoredSentencesQueryKey,
  getUser,
  getGetUserQueryKey,
  listArticles,
  getListArticlesQueryKey,
  listSendRecords,
  getListSendRecordsQueryKey,
  listNeighbors,
  getListNeighborsQueryKey,
  listUserArticleReads,
} from "@workspace/api-client-react";
import { getUserScopedOperatorPendingSpaceCodeRequestsQueryKey } from "@/lib/operatorPendingSpaceCodeRequestsQuery";

// getListUserArticleReadsQueryKey is not resolvable from the compiled dist
// types in every consumer (see app/(tabs)/to.tsx for the same workaround).
// Mirror its key shape locally instead of importing it; the shape must stay
// in sync with lib/api-client-react/src/user-article-reads.ts.
const getListUserArticleReadsQueryKey = (params: { userId: string }) =>
  ["/api/user-article-reads", params] as const;

function prefetch(
  queryClient: QueryClient,
  label: string,
  queryKey: QueryKey,
  fetcher: (signal?: AbortSignal) => Promise<unknown>,
): Promise<void> {
  return queryClient
    .prefetchQuery({ queryKey, queryFn: ({ signal }) => fetcher(signal) })
    .catch((err) => {
      // Best-effort cache warm-up only. A failed prefetch must never surface
      // as a toast/error state here — the owning tab's own query retries
      // normally (with its own loading/error handling) once it actually
      // mounts. Logging keeps the attempt visible for debugging.
      console.warn(`[prefetchTabData] ${label} prefetch failed:`, err);
    });
}

/**
 * Decides whether UserProvider should fire the background tab-data prefetch
 * for this render.
 *
 * `resolvedUserId` is what UserProvider actually uses everywhere else (either
 * an explicit `userId` prop or the session's own id) — but ProtectedRouteStack
 * (see app/_layout.tsx) always renders `<UserProvider userId={...}>` with the
 * real session's id, so the presence of that prop alone does NOT distinguish
 * a genuine production render from a test harness that renders UserProvider
 * with a bare userId and no real backing session. Requiring the session's own
 * user id to match `resolvedUserId` does: it is only true when a live,
 * confirmed AuthContext session actually authenticated as this exact user.
 */
export function shouldTriggerTabPrefetch(params: {
  sessionUserId: string | undefined;
  resolvedUserId: string;
}): boolean {
  const { sessionUserId, resolvedUserId } = params;
  return Boolean(resolvedUserId) && sessionUserId === resolvedUserId;
}

/**
 * Background-prefetches the "layer 1" list data that 수신(index)/공간(of)/
 * 보관(archive)/마이(to) tabs each read on their very first render, using the
 * exact same query keys and fetchers those screens' generated hooks use.
 *
 * Called once per confirmed user session (see UserProvider), around the same
 * time the 기록(on) tab — the app's initial tab — starts loading its own
 * data. Because it reuses identical query keys, React Query's own dedup +
 * staleTime rules apply automatically:
 * - A query already in flight (e.g. 기록 tab's own useListArticles /
 *   useListMyCollections requests) is not re-requested, just awaited.
 * - A query whose cached data is still fresh (within the global 30s
 *   staleTime) is skipped entirely.
 *
 * Intentionally excludes:
 * - 기록 tab's own exclusive queries (thoughts, question queue) — it is the
 *   visible tab and already fetches those itself; no prefetch needed.
 * - "Layer 2" data that only loads once a user drills into a sub-item
 *   (per-space letters, per-collection articles) — out of scope for this
 *   warm-up (see task #2196).
 */
export async function prefetchOtherTabsFirstLayerData(
  queryClient: QueryClient,
  userId: string,
): Promise<void> {
  if (!userId) return;
  // Never attempt this while offline: onlineManager already pauses React
  // Query fetches, but skipping outright avoids queuing work that would fire
  // in a burst the moment connectivity returns, competing with whatever the
  // user is actually looking at.
  if (!onlineManager.isOnline()) return;

  // ListInboxParams' generated type doesn't (yet) declare `isRead`, even
  // though the server supports it — see app/(tabs)/index.tsx for the same
  // cast, kept in sync here so the query key matches exactly.
  const inboxParams = { recipientId: userId, isRead: false } as Parameters<
    typeof listInbox
  >[0];

  await Promise.all([
    // 수신
    prefetch(queryClient, "inbox", getListInboxQueryKey(inboxParams), (signal) =>
      listInbox(inboxParams, { signal }),
    ),
    // 공간
    prefetch(queryClient, "spaces", getListSpacesQueryKey({ userId }), (signal) =>
      listSpaces({ userId }, { signal }),
    ),
    prefetch(
      queryClient,
      "space-invitations",
      getListMySpaceInvitationsQueryKey({ userId }),
      (signal) => listMySpaceInvitations({ userId }, { signal }),
    ),
    prefetch(
      queryClient,
      "space-code-requests",
      getListMySpaceCodeRequestsQueryKey({ userId }),
      (signal) => listMySpaceCodeRequests({ userId }, { signal }),
    ),
    prefetch(
      queryClient,
      "operator-pending-space-code-requests",
      getUserScopedOperatorPendingSpaceCodeRequestsQueryKey(userId),
      (signal) => listOperatorPendingSpaceCodeRequests({ signal }),
    ),
    // 보관
    prefetch(
      queryClient,
      "my-collections",
      getListMyCollectionsQueryKey({ ownerId: userId }),
      (signal) => listMyCollections({ ownerId: userId }, { signal }),
    ),
    prefetch(
      queryClient,
      "stored-sentences",
      getListStoredSentencesQueryKey({ userId }),
      (signal) => listStoredSentences({ userId }, { signal }),
    ),
    // 마이
    prefetch(queryClient, "user", getGetUserQueryKey(userId), (signal) =>
      getUser(userId, { signal }),
    ),
    prefetch(
      queryClient,
      "articles",
      getListArticlesQueryKey({ authorId: userId }),
      (signal) => listArticles({ authorId: userId }, { signal }),
    ),
    prefetch(
      queryClient,
      "send-records",
      getListSendRecordsQueryKey({ senderId: userId }),
      (signal) => listSendRecords({ senderId: userId }, { signal }),
    ),
    prefetch(
      queryClient,
      "neighbors",
      getListNeighborsQueryKey({ userId }),
      (signal) => listNeighbors({ userId }, { signal }),
    ),
    prefetch(
      queryClient,
      "user-article-reads",
      getListUserArticleReadsQueryKey({ userId }),
      (signal) => listUserArticleReads({ userId }, { signal }),
    ),
  ]);
}
