---
name: Friction date carousel vertical paging
description: Why date-group paging is key-based, one-step, and guarded against stale virtualized measurements.
---

One vertical gesture chooses only the current, previous, or next date key from the key active when the gesture began. Every destination is that group’s date-header anchor. Oversized groups do not expose an internal free-scroll interval.

**Why:** Delayed nearest-header correction produced mixed free-scroll/snap behavior, while tall groups behaved differently from short groups. Native momentum and stale async measurements could also defeat the selected page or restore a surviving date key to old geometry.

**How to apply:** Preserve the active date by key through refresh/filter/delete/queue changes, falling back only when that key disappears. Prefer mounted window-relative header measurements and deterministic per-key estimates for virtualized rows. Invalidate nested async measurements with a layout generation whenever data or viewport geometry changes. Keep non-card chrome deterministic across item counts, including the reserved dot row. On native, settle the chosen header before source momentum can roam and briefly lock the list; on web, route wheel/trackpad and vertical-dominant pointer drags through the same one-step decision while leaving horizontal carousel gestures alone.