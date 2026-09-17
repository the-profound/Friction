---
name: PostHog durable event deduplication
description: Reliable one-time lifecycle analytics across retries, refreshes, and process termination.
---

Persist a privacy-safe pending event payload and give each logical event a deterministic PostHog `$insert_id`. Mark it delivered only after capture; retry pending entries on startup.

**Why:** A local “sent” flag written before capture loses events when analytics is unavailable. A flag written only after capture can duplicate after process termination between capture and storage. PostHog can deduplicate the deterministic insertion ID on resend.

**How to apply:** Use this for transitions that may not occur again after restart, such as activation or first successful save. Never persist or transmit user-authored content in the outbox.