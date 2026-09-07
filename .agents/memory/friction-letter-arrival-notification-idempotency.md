---
name: Friction letter-arrival notification idempotency
description: Why the letter-arrived push job aggregates by exact delivery slot with a durable per-recipient claim instead of a rolling time window — read before changing when/how inbox rows get their visibleAt, or before changing the notification job's trigger points.
---

Any inbox-delivery pipeline that isn't perfectly synchronized with a separately-scheduled notification timer can commit its rows *after* the timer already ran for that moment, causing the timer to see zero recipients even though delivery genuinely happened for that slot — a rolling time-window aggregation query is inherently vulnerable to this, because whichever moment it queries "now" can be milliseconds before or after the real commit.

**Decision**: match notification aggregation to the delivery mechanism's own quantization (e.g. an exact scheduled-instant value) rather than a rolling window, and let the notification check be re-triggerable by the delivery pipeline itself (not just an independent timer) — whichever trigger runs first for a given delivery moment does the notifying.

**Why**: widening a time window only moves the race to a different boundary. Only pairing an exact match with a durable, atomically-claimed "already notified" marker (unique constraint + `ON CONFLICT DO NOTHING`, keyed by recipient + delivery moment) makes repeated or out-of-order triggers safe — each is a no-op after the first successful claim.

**How to apply**: if a new delivery path is added, verify it quantizes to the same moment values the aggregation query matches on, or its rows will be silently excluded. If a delivery-processing function's return shape changes, everything that reads it (schedulers, tests) must be updated together.
