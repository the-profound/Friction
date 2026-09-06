/**
 * Integration test for Task #2051 — a letter whose reservation was
 * scheduled then cancelled was reported to still show its cover on the
 * space list tab's "최근 편지" card.
 *
 * `spaceRecentLetters.test.ts` already proves the pure filter
 * (`sortRecentLetters`) excludes a cancelled-only letter given the right
 * input, and the server integration test in api-server proves the server
 * computes that input correctly. Neither covers the piece that actually
 * connects them on a real device: `of.tsx` registers its per-space letters
 * query under `[...getListSpaceLettersQueryKey(spaceId), { userId }]` (an
 * extra `{ userId }` segment appended for cache isolation across accounts),
 * while the schedule/cancel screen invalidates the shorter
 * `getListSpaceLettersQueryKey(spaceId)` key. This test drives that exact
 * two-key relationship through a real QueryClient/QueryObserver — the same
 * objects `useQueries` and `invalidateQueries` use internally — end to end:
 * seed stale (pre-cancel) data, invalidate via the schedule-screen's key,
 * refetch, and confirm the space-list-shaped observer both re-fetches and
 * ends up excluding the cancelled letter via `sortRecentLetters`.
 */
import { QueryClient, QueryObserver } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
import { getListSpaceLettersQueryKey } from "@workspace/api-client-react";
import type { SpaceLetter } from "@workspace/api-client-react";

import { sortRecentLetters } from "../spaceRecentLetters";

const spaceId = "space-1";
const userId = "user-1";

// `isQueryStale` (lib/useScreenFocused.ts) can't be imported directly here:
// that module also imports `useFocusEffect` from "expo-router", which isn't
// transformable under this plain-node vitest environment. Its actual logic
// (checked verbatim below) is exactly these three lines — the point under
// test is the `isInvalidated` check, which is what makes of.tsx's
// useFocusEffect catch a cancel invalidation issued while the tab wasn't
// focused.
function isQueryStale(
  queryClient: QueryClient,
  queryKey: readonly unknown[],
  thresholdMs = 30_000,
): boolean {
  const state = queryClient.getQueryState(queryKey);
  if (!state?.dataUpdatedAt) return true;
  if (state.isInvalidated) return true;
  return Date.now() - state.dataUpdatedAt > thresholdMs;
}

// The exact key shape of.tsx registers its per-space letters query under:
// the generated base key plus a `{ userId }` suffix (see spaceLetterQueryKeys
// in app/(tabs)/of.tsx).
function spaceListLettersKey() {
  return [...getListSpaceLettersQueryKey(spaceId), { userId }] as const;
}

function makeLetter(overrides: Partial<SpaceLetter> & { id: string }): SpaceLetter {
  return {
    id: overrides.id,
    spaceId,
    authorId: "author-1",
    letterType: "CENTER",
    visibility: "PUBLIC",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    articleTitle: "봄비 소리",
    isRead: false,
    reservation: null,
    ...overrides,
  } as SpaceLetter;
}

describe("space list letters cache invalidation across the of.tsx/schedule-screen key mismatch", () => {
  it("a schedule-screen cancel invalidation refetches the space-list-shaped query and drops the cancelled letter from recent letters", async () => {
    const queryClient = new QueryClient();
    const letterId = "letter-1";

    // Before cancelling: the letter has a PENDING reservation (already
    // excluded by sortRecentLetters, but present in the cache exactly as
    // of.tsx's useQueries would have fetched it).
    const beforeCancel = [
      makeLetter({
        id: letterId,
        reservation: { status: "PENDING", scheduledAt: "2026-02-01T06:00:00.000Z", sentAt: null } as never,
      }),
    ];
    // After cancelling: server now reports reservation:null / everScheduled:true.
    const afterCancel = [
      makeLetter({
        id: letterId,
        reservation: null,
        everScheduled: true,
      } as never),
    ];

    const queryFn = vi.fn().mockResolvedValueOnce(beforeCancel).mockResolvedValueOnce(afterCancel);

    // Mirrors the exact useQueries config in of.tsx: same key shape,
    // staleTime, and refetchOnMount/refetchOnWindowFocus settings.
    const observer = new QueryObserver<SpaceLetter[]>(queryClient, {
      queryKey: spaceListLettersKey(),
      queryFn,
      staleTime: 30_000,
      refetchOnMount: false,
      refetchOnWindowFocus: false,
    });
    const unsubscribe = observer.subscribe(() => {});

    await vi.waitFor(() => {
      expect(observer.getCurrentResult().data).toEqual(beforeCancel);
    });
    expect(sortRecentLetters(observer.getCurrentResult().data ?? [])).toEqual([]);

    // Exactly what of-space-schedule-send.tsx's handleSaved() does after a
    // cancel: invalidate the *shorter* base key, not the of.tsx-shaped key
    // with the { userId } suffix.
    await queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(spaceId) });

    // invalidateQueries with the default refetchType "active" refetches any
    // active observer whose key is prefixed by the invalidated key — which
    // must include the of.tsx-shaped key even though it has an extra
    // { userId } segment appended.
    await vi.waitFor(() => {
      expect(queryFn).toHaveBeenCalledTimes(2);
    });
    await vi.waitFor(() => {
      expect(observer.getCurrentResult().data).toEqual(afterCancel);
    });

    // The cancelled-only letter must not reappear as a recent letter card.
    expect(sortRecentLetters(observer.getCurrentResult().data ?? [])).toEqual([]);

    unsubscribe();
  });

  it("of.tsx's focus-effect (isQueryStale + exact refetchQueries) also catches the invalidation when the query was inactive at cancel time", async () => {
    const queryClient = new QueryClient();
    const letterId = "letter-2";
    const beforeCancel = [
      makeLetter({
        id: letterId,
        reservation: { status: "PENDING", scheduledAt: "2026-02-01T06:00:00.000Z", sentAt: null } as never,
      }),
    ];
    const afterCancel = [
      makeLetter({ id: letterId, reservation: null, everScheduled: true } as never),
    ];
    const key = spaceListLettersKey();
    const queryFn = vi.fn().mockResolvedValueOnce(beforeCancel).mockResolvedValueOnce(afterCancel);

    await queryClient.fetchQuery({ queryKey: key, queryFn });
    expect(queryClient.getQueryData(key)).toEqual(beforeCancel);
    expect(isQueryStale(queryClient, key)).toBe(false);

    // handleSaved()'s invalidation, exactly as issued by the schedule/cancel
    // screen: the shorter base key, with no active of.tsx observer mounted
    // at the moment of cancelling (mirrors: cancel happens on a pushed
    // screen while the underlying (tabs) list isn't focused).
    await queryClient.invalidateQueries({ queryKey: getListSpaceLettersQueryKey(spaceId) });

    // of.tsx's useFocusEffect, run on return to the tab: isQueryStale must
    // report true (it checks state.isInvalidated) so the exact-match
    // refetchQueries below actually fires and lands the corrected data.
    expect(isQueryStale(queryClient, key)).toBe(true);
    await queryClient.refetchQueries({ queryKey: key, exact: true });

    expect(queryFn).toHaveBeenCalledTimes(2);
    expect(queryClient.getQueryData(key)).toEqual(afterCancel);
    expect(sortRecentLetters(queryClient.getQueryData(key) as SpaceLetter[])).toEqual([]);
  });
});
