---
name: Autosave timeout ordering
description: Reliability rules for finite autosave status without allowing stale writes or restores to overtake newer editor content.
---

An autosave timeout may move the UI from “saving” to a retryable error, but it must not release the physical network request or storage-write serialization. A timed-out operation can still complete later; starting a newer operation concurrently lets the older payload finish last and overwrite or resurrect stale content.

**Why:** Promise timeouts do not cancel the underlying native storage or HTTP side effect. Treating the wrapper rejection as completion creates data-loss races even when client request IDs and dirty-state epochs are correct.

**How to apply:** Keep physical operations serialized until they truly settle, while giving UI callers a separate bounded wait. Guard delayed recovery reads with the dirty epoch captured before the read, and treat editor conversion/export errors as failures rather than successful empty snapshots.