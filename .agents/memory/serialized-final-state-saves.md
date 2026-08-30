---
name: Serialized final-state saves
description: Ordering rule when debounced autosaves and explicit commits can update the same persisted field.
---

All writes to the same final-state field must share one serialized async queue. Before an explicit commit, cancel its pending debounce timer and enqueue any pending value before the final value.

**Why:** A debounce request that already started can complete after a newer explicit commit and silently restore stale server state, even when the UI and cache show the newer value.

**How to apply:** Use when autosave and a confirm/upload/finalize action PATCH the same field. Disable conflicting controls during the explicit operation and retain pending state until its queued write succeeds.