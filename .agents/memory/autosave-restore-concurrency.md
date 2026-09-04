---
name: Autosave restore concurrency
description: Safe conflict handling when a local autosave queue is restored over server-backed content.
---

Only replay a server-backed local autosave when it carries the exact server-body baseline that was visible when the local edit began. Metadata or timestamps alone are insufficient; missing or ambiguous baselines remain recoverable conflicts rather than automatic writes.

**Why:** Server timestamps can lose precision across JSON, and a GET-to-PATCH race can otherwise erase a newer server edit. A successful save can also race with additional typing, leaving the next queued edit based on the version before that save.

**How to apply:** Use an atomic server-side compare-and-set against the exact baseline. After each successful save, synchronously rebase any newer queued generation inside the save serializer before another input event or retry can overwrite its baseline.