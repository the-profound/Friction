---
name: Friction question queue source bounds
description: Correctly bounding preliminary-question source selection without starving older unused thoughts.
---

When refilling a preliminary-question backlog, exclude source thoughts that have already been used by that user's generated questions, and generated question records themselves, before applying any newest-first candidate limit.

**Why:** Limiting first can repeatedly inspect a fully used recent window—or activated generated questions—and falsely conclude that no usable sources remain, even though older normal thoughts are still available.

**How to apply:** Keep an explicit finite candidate bound for AI work, but put the per-user used-source predicate in the database query (or otherwise page until enough unused sources are found) before that bound. Normalize an oversized FIFO queue before refresh/requeue/activation logic; trimming after moving the current item to the tail can delete the question the user explicitly refreshed. Source-based generation may fill toward the upper bound, while source-free generic prompts should supply only the guaranteed floor.