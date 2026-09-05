---
name: Detecting an unactivated queued question from a single fetch
description: How to tell a record is still a queued, unactivated question without a separate queue-membership query.
---

A question-origin record starts in a "preliminary/queued" status, and only one dedicated activation action ever moves it out of that status. No other code path changes it.

**Why:** this makes "created-from-question AND still in the preliminary status" a fully reliable signal from the record's own fetch response — no extra queue-table query needed to know it's still sitting in the queue, not yet opened.

**How to apply:** anywhere a screen needs to detect a still-queued question from an already-fetched record (e.g. redirecting a direct/deep-link entry into the activation flow instead of opening it as a plain edit), use this origin+status combination rather than adding a queue-membership check. The activation call is idempotent for an already-activated record and can take several seconds (it may trigger server-side regeneration work) — show a preparing/loading state, not a blocking spinner-less UI. Only treat a *confirmed* domain response (structured error body) as "this is really gone" and safe to navigate the user away; an unstructured/ambiguous failure from the activation call must stay retry-capable, not be reported as "gone."
