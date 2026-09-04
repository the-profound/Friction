---
name: Autosave timeout ordering
description: Reliability rules for finite autosave status without allowing stale writes or restores to overtake newer editor content.
---

An autosave timeout may move the UI from “saving” to a retryable error, but it must not release the physical network request or storage-write serialization. A timed-out operation can still complete later; starting a newer operation concurrently lets the older payload finish last and overwrite or resurrect stale content.

**Why:** Promise timeouts do not cancel the underlying native storage or HTTP side effect. Treating the wrapper rejection as completion creates data-loss races even when client request IDs and dirty-state epochs are correct.

**How to apply:** Keep physical operations serialized until they truly settle, while giving UI callers a separate bounded wait. Guard delayed recovery reads with the dirty epoch captured before the read, and treat editor conversion/export errors as failures rather than successful empty snapshots.

Any transition that moves title and body together must resolve both values from the same request-scoped editor export. Never combine a body returned by one export with a mutable “latest title” ref: an overlapping autosave export can update that ref before the transition continuation resumes.

**Why:** Concurrent editor exports may resolve out of order even when each response is individually current. A global latest-field ref can therefore create a title/body pair that never existed in the editor.

**How to apply:** Include every independently edited field in the export response, store the resolver per request ID and editor session, and resolve one immutable snapshot object. A WebView reload may retry the interrupted request only after the replacement session is ready.