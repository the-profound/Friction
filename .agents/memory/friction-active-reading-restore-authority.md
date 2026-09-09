---
name: Active-reading restore authority
description: Ordering rules for persisted active-reading restoration across auth startup, foreground re-entry, and local completion.
---

Protected navigation must not choose its initial landing route until active-reading persistence has reached a known hydrated state. An unfinished, current-user basic reading restore takes priority over the default records landing.

**Why:** Authentication recovery, default native landing, foreground storage reads, and completion clears can all finish in different orders. Treating an initial `null` as “no reading” or allowing an older read/write to finish last can lose or resurrect the reading.

**How to apply:** Serialize active-reading storage reads and writes, capture a restore revision before any asynchronous work, invalidate it synchronously on local set/clear, and close the navigation boundary again during foreground revalidation. Never persist or force-restore re-read mode.