import type { QueryClient, QueryKey } from "@tanstack/react-query";
import type { StoredSentence } from "@workspace/api-client-react";
import {
  getGetStoredSentenceQueryKey,
  getListStoredSentencesQueryKey,
} from "@workspace/api-client-react";

const listPrefix = getListStoredSentencesQueryKey()[0];

export type StoredSentenceFavoriteSnapshot = Array<{
  queryKey: QueryKey;
  data: StoredSentence | StoredSentence[] | undefined;
}>;

function isStoredSentenceListKey(queryKey: QueryKey, userId: string): boolean {
  if (queryKey[0] !== listPrefix) return false;
  const params = queryKey[1];
  return !!params && typeof params === "object" && "userId" in params && params.userId === userId;
}

function sortStoredSentences(sentences: StoredSentence[]): StoredSentence[] {
  return [...sentences].sort((a, b) => {
    if (a.isFavorite !== b.isFavorite) return a.isFavorite ? -1 : 1;
    if (a.isFavorite && b.isFavorite) {
      const favoriteDelta =
        new Date(b.favoritedAt ?? 0).getTime() - new Date(a.favoritedAt ?? 0).getTime();
      if (favoriteDelta !== 0) return favoriteDelta;
    }
    return new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime();
  });
}

function updateList(
  previous: StoredSentence[] | undefined,
  updated: StoredSentence,
  favoritesOnly: boolean,
): StoredSentence[] | undefined {
  if (!previous) return previous;
  const withoutUpdated = previous.filter((item) => item.id !== updated.id);
  if (favoritesOnly && !updated.isFavorite) return withoutUpdated;
  return sortStoredSentences([...withoutUpdated, updated]);
}

export async function optimisticallySetStoredSentenceFavorite(
  queryClient: QueryClient,
  userId: string,
  sentence: StoredSentence,
  isFavorite: boolean,
): Promise<{ optimistic: StoredSentence; snapshot: StoredSentenceFavoriteSnapshot }> {
  const detailKey = getGetStoredSentenceQueryKey(sentence.id);
  await Promise.all([
    queryClient.cancelQueries({ queryKey: detailKey }),
    queryClient.cancelQueries({ queryKey: [listPrefix] }),
  ]);

  const listEntries = queryClient
    .getQueriesData<StoredSentence[]>({ queryKey: [listPrefix] })
    .filter(([key]) => isStoredSentenceListKey(key, userId));
  const snapshot: StoredSentenceFavoriteSnapshot = [
    { queryKey: detailKey, data: queryClient.getQueryData<StoredSentence>(detailKey) },
    ...listEntries.map(([queryKey, data]) => ({ queryKey, data })),
  ];
  const optimistic: StoredSentence = {
    ...sentence,
    isFavorite,
    favoritedAt: isFavorite ? new Date().toISOString() : null,
  };

  queryClient.setQueryData(detailKey, optimistic);
  for (const [queryKey, previous] of listEntries) {
    const params = queryKey[1] as { favorite?: boolean };
    queryClient.setQueryData(queryKey, updateList(previous, optimistic, params.favorite === true));
  }
  return { optimistic, snapshot };
}

export function applyStoredSentenceFavoriteResponse(
  queryClient: QueryClient,
  userId: string,
  updated: StoredSentence,
): void {
  queryClient.setQueryData(getGetStoredSentenceQueryKey(updated.id), updated);
  for (const [queryKey, previous] of queryClient
    .getQueriesData<StoredSentence[]>({ queryKey: [listPrefix] })
    .filter(([key]) => isStoredSentenceListKey(key, userId))) {
    const params = queryKey[1] as { favorite?: boolean };
    queryClient.setQueryData(queryKey, updateList(previous, updated, params.favorite === true));
  }
}

export function rollbackStoredSentenceFavorite(
  queryClient: QueryClient,
  snapshot: StoredSentenceFavoriteSnapshot,
): void {
  for (const { queryKey, data } of snapshot) queryClient.setQueryData(queryKey, data);
}