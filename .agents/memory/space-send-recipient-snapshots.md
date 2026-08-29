---
name: Space send recipient snapshots
description: Durable recipient-set rules for atomic space-letter delivery, retries, and historical repair.
---

Freeze a space send's recipient set inside the same locked transaction that creates delivery rows and marks the reservation sent. Every retry and repair must use that immutable snapshot rather than current participation rows.

**Why:** Participation status and nicknames can change after delivery, and historical rows do not have a dedicated approval timestamp. Recomputing later can omit original recipients or retroactively deliver to someone approved after the send.

**How to apply:** For new sends, snapshot approved recipients plus the operator, excluding the author, before inbox insertion. For legacy sends without a snapshot, use only conservative pre-cutoff evidence and preserve already-proven delivery rows.