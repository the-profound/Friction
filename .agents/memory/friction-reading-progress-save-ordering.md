---
name: Reading progress save ordering
description: Durable rules for preserving reading position across native app suspension and out-of-order saves.
---

An app-state suspension boundary must invalidate any active page-turn generation, cancel pager animations, and immediately persist the latest hydrated reading position. A client-side request abort is not sufficient ordering protection; every save needs a monotonic revision that the server conditionally accepts only when newer.

**Why:** iOS can deliver `inactive` and `background` while a gesture callback or debounced save is still pending. Canceled network requests may already be executing on the server, so an older request can otherwise overwrite the lifecycle flush after it arrives.

**How to apply:** Coalesce one non-active cycle, reject every callback from its interrupted gesture, do not flush provisional pre-hydration page zero, reuse same-position in-flight saves, retire older debounce generations, and enforce revision comparison in the database upsert.