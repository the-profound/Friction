---
name: Bounded autosave persistence queues
description: Why autosave snapshot coalescing must not weaken deletion and transition ordering.
---

Keep at most one not-yet-started dirty snapshot per barrier-delimited segment. A running physical write is never abandoned, and deletion, entity binding, and stage-transition writes are never coalesced.

**Why:** Slow or stalled native storage can otherwise retain one full document string and Promise closure per keystroke until Hermes runs out of memory. Moving or swallowing a durability barrier can instead resurrect pre-delete or pre-transition content after restart.

**How to apply:** For editor persistence or pre-ready bridge queues, replace only commands in the current coalescible segment and keep the replacement at its newest logical position. A failed or timed-out barrier must prevent the caller from reporting success.