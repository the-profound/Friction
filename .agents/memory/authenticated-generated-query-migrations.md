---
name: Authenticated generated query migrations
description: Safe migration rule when an authenticated API replaces a client-supplied query identity parameter.
---

When an API becomes authenticated and a generated query parameter is removed, update every generated-client consumer in the same change: direct requests, query hooks, and query-cache keys.

**Why:** Generated React Query hooks use positional arguments. A stale second parameter can be accepted as the options argument, silently discarding the real options object and its `enabled` guard or cache key. The app can then request authenticated data before identity is ready.

**How to apply:** After code generation, search the workspace for direct calls, hook calls, and query-key helpers for that operation. Update all signatures before relying on type checks or runtime behavior.