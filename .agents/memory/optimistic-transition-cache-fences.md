---
name: Optimistic transition cache fences
description: How to keep destination screens stable while a background save or status transition is still in flight.
---

An optimistic record transition needs a cache-level generation fence in addition to domain `updatedAt` comparisons. A refetch can arrive later and React Query may apply it regardless of the server timestamp, so destination screens must compare the active transition's staged fields and status before accepting the response.

**Why:** Review/closing navigation is intentionally non-blocking; accepting an older response after navigation can replace the user's newest document or make the destination appear to move backward.

**How to apply:** Stage the complete destination snapshot before navigation, retain its generation until a newer response confirms the staged fields, and keep background failures from restoring older cache data. Use a durable local recovery snapshot for content that has not reached the server yet.

During a transition that changes entity identity, the destination may be shown before the new server ID exists, but controls that mutate only the destination entity must remain disabled until that identity is confirmed.

**Why:** A provisional review surface can still carry the thought route ID; enabling article-only actions in that window sends valid-looking mutations to the wrong resource.

**How to apply:** Separate presentation readiness from mutation readiness. Render the destination snapshot immediately, keep autosave and destination-only controls locked during the identity handoff, then enable them only after the new entity is bound.