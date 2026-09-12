---
name: Claim ledgers need discoverable retry state, lease fencing, and a monotonic progress cursor
description: Three compounding requirements for an at-most-once claim ledger that must also guarantee retries happen safely — a two-counter design alone is insufficient.
---

A claim ledger for "has this recipient/key already been notified/processed" needs three separate pieces of correctness, and a design that gets only one or two of them will look correct in normal operation but fail under concurrency, crashes, or deletion:

**1. Discoverable retry state (not just resolved/unresolved).** A ledger that only tracks "claimed" vs. "notified" counts (or any two-state resolved/unresolved compression) can correctly prevent double-processing, but a *released* claim (an attempt that failed and gave up its exclusivity) looks identical to a *fully resolved* one to any query that doesn't also record when release happened.

**Why:** Releasing a claim only makes it *eligible* for reclaim by whatever the next caller happens to check. If production's actual triggers are event-driven (a timer that fires once for a specific key, or a sweep that only rechecks keys with fresh incoming activity), a released-but-not-yet-retried claim can wait forever with nothing to prompt it.

**How to apply:** Add a `lockedAt`/leased-at timestamp — set when claimed, cleared only on release, never on confirm-through-a-different-path. This turns "unresolved and not actively locked" into a directly queryable condition (`claimed != notified AND (locked_at IS NULL OR locked_at < staleness_threshold)`), so a periodic sweep can proactively recheck exactly those keys. The same timestamp doubles as crash recovery: a lock older than a staleness threshold (comfortably longer than one real attempt, comfortably shorter than the sweep interval) is presumed abandoned and becomes reclaimable without an explicit release.

**2. Lease/generation fencing on every resolution call.** A staleness threshold alone is not enough once a *presumed-dead* attempt can still finish late and call confirm/release after a newer attempt has already reclaimed the same key. If confirm/release are guarded only by a count or a plain claimed/notified comparison (no identity of *which* attempt is resolving), the late call from the dead attempt can match the newer attempt's row and corrupt its state — double-sending, or wrongly clearing a live lock out from under it.

**Why:** A staleness threshold governs when a key becomes reclaimable, but does nothing to stop the original attempt's eventual, out-of-band resolution from being applied to whatever now occupies that key. Presumed-dead is not actually-dead; slow processes, GC pauses, and network partitions can all cause a "dead" attempt to resurface after reclaim.

**How to apply:** Mint a fresh opaque lease/generation id (e.g. a UUID) on every claim and reclaim. Store it on the ledger row. Require every confirm/release call to pass the lease id it was given, and guard the `UPDATE ... WHERE` on an exact match against the row's current lease id (not just the key). A call carrying a stale lease id then matches zero rows and is a safe no-op.

**3. A monotonic, deletion-proof progress cursor — never a live COUNT or a mutable aggregate.** If "how much of a recipient's work is claimed/notified" is computed as `COUNT(*)` (or any other live aggregate) over rows that can be deleted independently of this ledger, a legitimate deletion of an already-processed row can make the count fail to exceed the previously recorded value even after new work has genuinely arrived — silently dropping the follow-up.

**Why:** A count only reflects rows that currently exist. Anything (a user action, a cleanup job, cascading deletes) that can remove a row the ledger already accounted for breaks the assumption that the count only ever grows.

**How to apply:** Track progress via a genuinely append-only, monotonic identity instead — a `bigserial`/sequence column on the source table, assigned once per row and never reused or renumbered, even after that row (or any other row) is deleted. Store `claimedThroughSequence`/`notifiedThroughSequence` cursors on the ledger and compare against the *current* rows' sequence numbers to compute the delta, rather than diffing two aggregate counts.

These three requirements compound: a design can pass tests that don't exercise concurrency, crashes, or deletion and still be broken in production. When building any "claim once, retry safely" ledger, check all three explicitly before considering the design complete.
