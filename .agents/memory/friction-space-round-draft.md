---
name: Friction space-round draft data flow
description: SpaceRound rows exist from space creation onward; how "draft" state relates to DB rows; loading-vs-empty pitfall for rounds-derived queries.
---

SpaceRound rows exist from space creation onward (title/description nullable); "draft" = current DB rows, not local-only UI state — seed local state from them, don't reintroduce blank defaults.

## Loading vs. empty pitfall

`useListSpaceRounds(...).data ?? []` makes `rounds` look like "no rounds" both while the
query is still loading (no data yet) and after it resolves with a genuinely empty list.
Any downstream `useEffect`/`useMemo` that derives an "assigned/available" list from `rounds`
must check `roundsQuery.isLoading` explicitly and stay in an undefined/loading state until
the query actually resolves — otherwise it will emit a confident-looking empty result before
real data arrives (e.g. an "아직 배정된 차례가 없어요" empty-state flashing for users who do
have data, right after navigating to the screen).

**Why:** happened in `of-space-schedule-send.tsx`'s CENTER-slot-assignment calculation, which
is reused by later "assigned turn" scheduling screens — the same pattern is likely to recur
wherever a query's `?? []` fallback feeds a "does the user have any X" branch.

**How to apply:** when deriving a "does the user have X" boolean/list from a paginated/query
result, gate on the source query's `isLoading` (not just presence of `!id`/`!userId`) before
concluding the list is empty.
