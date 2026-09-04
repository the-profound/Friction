---
name: Mutation-window query retirement
description: Preventing stale React Query list responses from overwriting an authoritative mutation response.
---

When a mutation writes its response directly into one or more React Query list
caches, cancel and await those list queries twice: once before starting the
mutation, and again immediately after the mutation response but before any cache
write. Perform the authoritative cache writes synchronously after the second
cancellation.

**Why:** A single pre-mutation cancellation retires existing requests, but an
active observer can start another list request while the mutation is in flight.
That request can read old server state and resolve after the mutation, reverting
the cache. The second cancellation closes this mutation-window race.

**How to apply:** Use this boundary for create, update, and delete paths that
manually update list caches. If the UI must remain stable through the following
authoritative refetch, keep a content fence or deletion tombstone until that
refetch confirms the exact saved state.