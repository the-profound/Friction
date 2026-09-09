import { QueryClient } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import type { StoredSentence } from "@workspace/api-client-react";
import {
  getGetStoredSentenceQueryKey,
  getListStoredSentencesQueryKey,
} from "@workspace/api-client-react";
import {
  applyStoredSentenceFavoriteResponse,
  optimisticallySetStoredSentenceFavorite,
  rollbackStoredSentenceFavorite,
} from "../storedSentenceFavoriteCache";

const sentence = (overrides: Partial<StoredSentence> = {}): StoredSentence => ({
  id: "sentence-1",
  userId: "user-1",
  articleId: "article-1",
  text: "문장",
  sourceText: null,
  isFavorite: false,
  favoritedAt: null,
  createdAt: "2026-01-01T00:00:00.000Z",
  articleTitle: "글 제목",
  articleAuthorName: "저자",
  ...overrides,
});

describe("stored sentence favorite cache", () => {
  it("immediately updates detail, sorting, and the favorites filter", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-05T00:00:00.000Z"));
    const client = new QueryClient();
    const item = sentence();
    const olderFavorite = sentence({
      id: "sentence-2",
      isFavorite: true,
      favoritedAt: "2026-01-02T00:00:00.000Z",
    });
    const allKey = getListStoredSentencesQueryKey({ userId: "user-1" });
    const favoriteKey = getListStoredSentencesQueryKey({ userId: "user-1", favorite: true });
    client.setQueryData(getGetStoredSentenceQueryKey(item.id), item);
    client.setQueryData(allKey, [olderFavorite, item]);
    client.setQueryData(favoriteKey, [olderFavorite]);

    await optimisticallySetStoredSentenceFavorite(client, "user-1", item, true);

    expect(client.getQueryData<StoredSentence>(getGetStoredSentenceQueryKey(item.id))?.isFavorite).toBe(true);
    expect(client.getQueryData<StoredSentence[]>(allKey)?.map(({ id }) => id)).toEqual(["sentence-1", "sentence-2"]);
    expect(client.getQueryData<StoredSentence[]>(favoriteKey)?.map(({ id }) => id)).toEqual(["sentence-1", "sentence-2"]);
    vi.useRealTimers();
  });

  it("restores the exact previous caches after a failed request", async () => {
    const client = new QueryClient();
    const item = sentence();
    const allKey = getListStoredSentencesQueryKey({ userId: "user-1" });
    const favoriteKey = getListStoredSentencesQueryKey({ userId: "user-1", favorite: true });
    client.setQueryData(getGetStoredSentenceQueryKey(item.id), item);
    client.setQueryData(allKey, [item]);
    client.setQueryData(favoriteKey, []);

    const { snapshot } = await optimisticallySetStoredSentenceFavorite(client, "user-1", item, true);
    rollbackStoredSentenceFavorite(client, snapshot);

    expect(client.getQueryData(getGetStoredSentenceQueryKey(item.id))).toEqual(item);
    expect(client.getQueryData(allKey)).toEqual([item]);
    expect(client.getQueryData(favoriteKey)).toEqual([]);
  });

  it("reconciles all caches to the final server response", () => {
    const client = new QueryClient();
    const optimistic = sentence({ isFavorite: true, favoritedAt: "2026-09-05T00:00:00.000Z" });
    const server = sentence({ isFavorite: false, favoritedAt: null });
    const allKey = getListStoredSentencesQueryKey({ userId: "user-1" });
    const favoriteKey = getListStoredSentencesQueryKey({ userId: "user-1", favorite: true });
    client.setQueryData(getGetStoredSentenceQueryKey(server.id), optimistic);
    client.setQueryData(allKey, [optimistic]);
    client.setQueryData(favoriteKey, [optimistic]);

    applyStoredSentenceFavoriteResponse(client, "user-1", server);

    expect(client.getQueryData(getGetStoredSentenceQueryKey(server.id))).toEqual(server);
    expect(client.getQueryData(allKey)).toEqual([server]);
    expect(client.getQueryData(favoriteKey)).toEqual([]);
  });
});