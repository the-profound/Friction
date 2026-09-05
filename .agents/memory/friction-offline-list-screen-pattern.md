---
name: friction-offline-list-screen-pattern
description: How a list/profile screen (e.g. 마이 탭) should branch loading/empty/error state once its queries are covered by the offline disk-cache allowlist, and how to gate network-only actions.
---

# Offline-aware list screen pattern

Once a query's path is in the disk-cache allowlist (see
`friction-offline-query-persistence.md`), React Query already restores its
`data` from disk before any network round-trip and never nulls `data` out
just because a refetch is paused offline. That means most of "instant show
on relaunch" and "keep showing data while offline" falls out for free from
existing `ListEmptyComponent`-style patterns — **do not** invent a separate
offline cache/state layer for a screen that already uses React Query for
these lists.

What a screen still needs to add deliberately:

1. **A tri-state empty/loading render, keyed off the query itself**, not a
   hardcoded boolean: `isLoading` (true spinner, no data yet) vs `isPending
   && !isOnline` (no cache ever existed and we're offline — show a distinct
   "오프라인 상태예요" message, not the misleading normal empty-state copy)
   vs genuinely empty (loaded, online or not, list has zero items).
2. **`useIsOnline()`** (`lib/useIsOnline.ts`, a `useSyncExternalStore` wrapper
   over `onlineManager`) to gate *network-triggered actions only* — manual
   pull-to-refresh, an error screen's "다시 시도" button, a focus-effect
   staleness refetch. Never use it to decide whether to render cached data;
   render cached data unconditionally.
3. When a network-only action is attempted offline, show a toast/explicit
   notice ("오프라인 상태예요. 네트워크 연결 후 다시 시도해주세요.") instead
   of silently no-op'ing (React Query already no-ops the actual fetch when
   paused, but a silent no-op reads as broken to the user).
4. Give every list on the screen its own error branch (`query.isError`) —
   a screen with two tabs/lists (e.g. letters + spaces) needs both wired,
   not just the first one that historically had it.

**Why:** built for the 마이 탭 (profile/letters/spaces/send-records/neighbors)
cold-start + offline task; the actual gap was never data persistence (that
infra already existed) but the loading/empty/error branching and explicit
offline affordances layered on top of it.

**How to apply:** any list-style tab screen already reading from an
allowlisted query. Reuse `useIsOnline()` rather than adding a new NetInfo
subscription per screen.
