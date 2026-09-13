---
name: Serialized final-state saves
description: Ordering rule when debounced autosaves and explicit commits can update the same persisted field.
---

All writes to the same final-state field must share one serialized async boundary. If intermediate values are disposable, keep the active request but coalesce every waiting request to the latest value. The boundary must outlive screens that navigate away before persistence finishes.

**Why:** A debounce request that already started can complete after a newer explicit commit and silently restore stale server state. A screen-owned queue does not prevent this after unmount/remount, and an early query invalidation can replace the optimistic latest value with stale server data.

**How to apply:** Use when autosave and a confirm/upload/finalize action PATCH the same field. Key the boundary by entity, invalidate queries only after the latest save succeeds, make stale retry actions conditional, and await idle only at operations that require physical persistence.