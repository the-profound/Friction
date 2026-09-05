---
name: Create retry generations
description: Ordering rule for response-loss retries that reuse a client-generated identity.
---

When a create request may be retried with the same client ID but newer content, persist a monotonic request generation beside the ID. The server must serialize by ID and only let a strictly newer generation update content; stale generations return the current durable row, and divergent equal generations conflict.

**Why:** A timed-out request can still commit after a retry. An idempotency ID alone deduplicates rows but cannot determine which payload is newer, and keeping the generation only in memory fails after app restart.

**How to apply:** Use this for any create flow whose local draft survives response loss or process death. Store ID and generation in the same durable queue payload, advance the generation before persisting a retry, and reconcile caches from the server response rather than assuming the submitted payload won.