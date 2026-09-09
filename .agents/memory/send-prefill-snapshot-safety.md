---
name: Send prefill snapshot safety
description: Safety boundary between instant route-entry letter display and current server authorization to send.
---

An entry screen may prime the shared letter-list cache with the exact letter it already owns so the send screen can display it on its first render. Treat that snapshot as presentation-only: keep send actions disabled until a fresh, authenticated server list has confirmed the same letter is still eligible.

**Why:** A route-entry snapshot removes visible network latency but may be stale. Treating it as authoritative could send a letter whose status changed or preserve a previous selection when a mounted screen is reused.

**How to apply:** Mark the primed query stale immediately, guard the query on authenticated user identity, and bind verified selection state to the current route-entry generation. On generation change, clear the previous selection and reply-derived defaults before reconciliation.