---
name: Distinguishing "not found" from "route not implemented" on a 404
description: How to tell a genuine missing-record 404 apart from an unmatched/unimplemented route, using the error body shape alone.
---

A genuine domain 404 (e.g. "this record doesn't exist") comes back with a structured JSON error body. A route that doesn't exist yet on the server (stale client, or server hasn't deployed it) falls through to a framework default 404 handler, which returns a plain-text/HTML body instead.

**Why:** without this distinction, "this feature isn't deployed yet" looks identical to "this record was deleted" to the caller, sending users down the wrong recovery path and preventing cause-specific error copy. It also matters for retry/fallback logic: an unstructured 404 on a specific endpoint is a terminal, unrelated failure — falling through to try a different endpoint next lets that endpoint's unrelated response (of any shape) overwrite the real cause.

**How to apply:** classify a 404 by whether the body is a parsed object (structured domain error) vs. a string/HTML (route not implemented), not by status code alone. Only treat a 404 as "safe to try a fallback lookup" when its body is structured.
