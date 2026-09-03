---
name: Idempotent transition retries
description: Client retry behavior when a server-side state transition may have committed before its response was lost.
---

When a state-transition endpoint is idempotent, retain the exact prerequisite snapshot after it has been persisted. If the transition response is ambiguous and the user retries without changing that snapshot, call the transition endpoint again without repeating prerequisite writes.

**Why:** The first transition may have committed and deleted or invalidated its source entity. Repeating a PATCH/save against that source can fail before the client reaches the idempotent endpoint, stranding the user even though server recovery is available.

**How to apply:** For save-then-transition flows, record the entity ID and saved payload immediately after the save succeeds. Clear the marker on confirmed transition success; preserve it on ambiguous transition failure; bypass the save only when the retry payload matches exactly.