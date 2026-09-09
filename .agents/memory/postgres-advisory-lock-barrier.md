---
name: PostgreSQL advisory lock barriers
description: Deterministically ordering concurrent integration requests around transaction-scoped advisory locks.
---

For PostgreSQL concurrency tests, acquire the same advisory transaction lock in a dedicated barrier transaction, start each request only after the preceding request appears as a waiter in `pg_locks`, then commit the barrier. For a single-int hash, a negative `hashtext` key is exposed as `classid=4294967295` plus an unsigned `objid`, not `classid=0`.

**Why:** Starting two HTTP requests after a shared lock is released does not guarantee their database acquisition order, and filtering `pg_locks` as if every signed hash were positive causes false timeouts.

**How to apply:** Poll `pg_locks` for the exact advisory key before starting the next request; use a unique per-test lock name and always roll back/release the barrier connection on setup failure.