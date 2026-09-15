---
name: Reading analytics session identity
description: Durable identity and deduplication rules for reading-funnel analytics.
---

Persist a reading analytics session identity with active-reading recovery, and use deterministic analytics event IDs derived from that identity (or the created entity ID).

**Why:** Component refs prevent duplicate effects only within one mount. App restoration, ambiguous network retries, and mounted route identity changes can otherwise resend events or associate stale reading state with a new article.

**How to apply:** Gate state-derived reading events on hydration for the current reader identity. Start a new identity for a deliberate reread, preserve it across restoration, and use the server-created entity ID for successful-create outcome events.