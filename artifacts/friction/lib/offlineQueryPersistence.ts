import Constants from "expo-constants";
import type { PersistQueryClientOptions } from "@tanstack/react-query-persist-client";
import { createAsyncStoragePersister } from "@tanstack/query-async-storage-persister";
import AsyncStorage from "@react-native-async-storage/async-storage";
import type { QueryKey } from "@tanstack/react-query";

/**
 * Offline-first disk cache for React Query.
 *
 * Scope: only "light bumper data" needed to paint a screen instantly on cold
 * start / while offline is written to disk — the 수신함 표지 목록 (inbox list)
 * and everything the 마이 탭 renders (profile, my letters list, my spaces
 * list, send records, neighbors). Everything else (letter bodies, memos,
 * drafts, team collections, ...) stays memory-only exactly as before; it is
 * simply never dehydrated, so it never touches AsyncStorage.
 *
 * Bump `PERSISTED_QUERY_CACHE_SCHEMA_VERSION` whenever a persisted query's
 * response shape changes in a way that would make an old cached payload
 * unsafe to render with new code (renamed/removed field, changed enum
 * values, list->object, etc). Bumping it discards every previously
 * persisted cache entry on the next launch, regardless of the app version.
 * The app version is *also* folded into the buster below, so a normal
 * store release invalidates old caches automatically even if nobody
 * remembers to bump the schema version by hand.
 */
export const PERSISTED_QUERY_CACHE_SCHEMA_VERSION = 1;

const PERSISTED_QUERY_CACHE_STORAGE_KEY = "friction-offline-query-cache";

// Exact URL paths for *list* endpoints (as stored in queryKey[0] by the
// orval-generated hooks, e.g. getListInboxQueryKey/getListArticlesQueryKey -
// see lib/api-client-react/src/generated/api.ts at the repo root). Detail
// endpoints append an id segment ("/api/articles/<id>") and therefore never
// match this exact-string set, which is what keeps letter bodies, memo
// detail fetches, drafts, etc. out of the disk cache automatically.
const PERSISTED_LIST_PATHS = new Set<string>([
  "/api/inbox", // 수신함 표지 목록 - useListInbox
  "/api/articles", // 내 편지 목록 - useListArticles
  "/api/spaces", // 내 공간 목록 - useListSpaces
  "/api/send-records", // 발송기록 - useListSendRecords
  "/api/neighbors", // 이웃 목록 - useListNeighbors
]);

// "/api/users/<id>" (profile - useGetUser) exactly, but not a nested
// sub-resource like "/api/users/<id>/space-letters" or
// "/api/users/<id>/recent-collection".
const USER_PROFILE_PATH_PATTERN = /^\/api\/users\/[^/]+$/;

/**
 * Mechanical allowlist predicate: matches purely on the query's URL path
 * (queryKey[0]), never on which hook/screen called it. The same generated
 * hook (e.g. useListArticles) is reused elsewhere with different params for
 * non-allowlisted purposes, but it always resolves to the same path, so
 * path-based matching stays correct without a call-site registry.
 */
export function isPersistedOfflineQuery(queryKey: QueryKey): boolean {
  const path = queryKey[0];
  if (typeof path !== "string") return false;
  if (PERSISTED_LIST_PATHS.has(path)) return true;
  return USER_PROFILE_PATH_PATTERN.test(path);
}

const offlineQueryStoragePersister = createAsyncStoragePersister({
  storage: AsyncStorage,
  key: PERSISTED_QUERY_CACHE_STORAGE_KEY,
});

const appVersion = Constants.expoConfig?.version ?? "unknown";

export const offlineQueryPersistOptions: Omit<PersistQueryClientOptions, "queryClient"> = {
  persister: offlineQueryStoragePersister,
  // A stale restore is worse than none: cap disk cache lifetime even if
  // nobody bumps the schema/app version.
  maxAge: 24 * 60 * 60 * 1000,
  buster: `${appVersion}:${PERSISTED_QUERY_CACHE_SCHEMA_VERSION}`,
  dehydrateOptions: {
    shouldDehydrateQuery: (query) =>
      isPersistedOfflineQuery(query.queryKey) && query.state.status === "success",
  },
};
