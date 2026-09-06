---
name: Space list recent-letters cache invalidation wiring
description: Verified query-key relationship between of.tsx's space-letters query and the schedule/cancel screen's invalidation, for future "stale recent letter cover" reports.
---

## Context

Task #2014 fixed the `sortRecentLetters` pure filter and the server's
`everScheduled`/`reservation` computation so a letter with only a
*cancelled* scheduled-send reservation is excluded from a space's "최근
편지" mini-cover cards. Task #2051 investigated a report that a
cancelled-reservation letter still reappeared on a real device after that
fix.

## What was verified (exhaustively, across a full session)

- Server `GET /spaces/:id/letters` (`artifacts/api-server/src/routes/spaces.ts`)
  correctly computes `reservation: null` / `everScheduled: true` for a
  cancelled-only letter, including when the reservation history has
  **multiple** rows (schedule → cancel → reschedule → cancel again) —
  verified both by inserting rows directly into the live Supabase dev DB and
  calling the live API, and via an added integration test.
- `of.tsx` registers its per-space letters query under
  `[...getListSpaceLettersQueryKey(spaceId), { userId }]` (base key + an
  extra `{ userId }` segment for cross-account cache isolation). The
  schedule/cancel screen (`of-space-schedule-send.tsx`) invalidates only the
  shorter `getListSpaceLettersQueryKey(spaceId)`. This is **not a bug**:
  `invalidateQueries`/`refetchQueries` do a *prefix* match by default
  (`exact: false`), so the shorter key correctly matches and refetches the
  longer of.tsx-shaped key. Verified with a real `QueryClient`/`QueryObserver`
  in `artifacts/friction/lib/__tests__/spaceRecentLettersCacheInvalidation.test.ts`,
  covering both the active-observer path (auto-refetch on invalidate) and
  the inactive-query path (of.tsx's `useFocusEffect` + `isQueryStale`
  checking `state.isInvalidated`, then an exact-match `refetchQueries`).
- No other integration seam (offline AsyncStorage query persistence, a
  zustand/MMKV persisted store, Supabase Realtime, the scheduled-send sweep
  processor, the openapi/zod response shape, the visibility gate for
  other-authors' letters) touches this data path in a way that could
  resurrect a cancelled reservation.

**Why:** after this verification, no active defect was found in the
post-#2014 code for this exact scenario, including multi-cycle history — so
if this bug resurfaces, suspect either a build that predates the #2014 fix
reaching the reporter's device, or a genuinely new regression, and start
from the integration tests above (extend them) rather than re-deriving this
whole chain from scratch.

**How to apply:** when a future report says a space-list recent-letter
cover shows a letter that should be excluded, first run/extend
`spaceRecentLetters.test.ts` (pure filter), the server's
`spaces.letter-reservation-metadata.api.test.ts` (server computation,
including multi-cycle), and `spaceRecentLettersCacheInvalidation.test.ts`
(cache wiring) before assuming any of those three layers is newly broken.
