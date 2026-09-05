---
name: Question-queue resilience patterns
description: How to keep a list screen consistent when a secondary/derived query can fail independently of the primary list query, plus a reusable error-classification trick and a toast-dedup shape.
---

# Question-queue resilience patterns

## Don't trust a derived filter set alone to hide items from a primary list
A list screen that filters out items belonging to a secondary feature (e.g. "hide
queue questions from the ordinary thought list") must not rely solely on an ID set
built from that secondary query's successful response. If the secondary query fails,
the ID set is empty/stale and the items leak back into the primary list with the
wrong visual style and the wrong tap behavior — while the secondary query's own
error toast fires, producing a confusing multi-symptom bug that looks unrelated to
its root cause.

**Why:** this exact bug hit the friction records screen: a question still sitting in
the server-side queue would show up as a plain white thought card whenever
`useGetThoughtQuestionQueue` failed, because the exclusion filter only checked
`queuedIds` (built from that query's data).

**How to apply:** whenever a filter's correctness depends on a query that can fail
independently, add a second, self-sufficient check derived from the primary
entity's own persisted fields (not the secondary query's response), and OR it
together with the original ID-set check — never replace one with the other, so the
success path is provably unchanged. See `isPendingQueueQuestionThought` in
`artifacts/friction/lib/recordList.ts` for the concrete field-based predicate used
for question-queue thoughts.

## Trick: an endpoint's "impossible" status code is a safe version-mismatch signal
If you read an endpoint's server handler and confirm it never itself returns a given
HTTP status for that route (e.g. a GET handler that always resolves 200 with a
snapshot, never a 404), then a client actually receiving that status on calls to
that exact endpoint can only mean a routing-layer problem — most commonly the route
doesn't exist on the server build the client is talking to (client/server version
skew). This is safe to classify as a distinct "unsupported/not available" error
kind, separate from generic 5xx or 4xx handling, and its user-facing copy should
avoid "please retry" language since retrying cannot fix a missing route.

**How to apply:** before adding a new error classification bucket keyed on a status
code, grep the actual route handler to confirm it never emits that code itself —
otherwise the classification will misfire on a legitimate application-level error.

## Toast dedup shape for a repeatedly-retried/refetched query
For any query that retries or refetches automatically and surfaces failures via a
toast, keep a ref holding the last-shown failure "kind" (a classified bucket, not
the raw error). Skip showing the toast when the new failure classifies to the same
kind as the ref. Reset the ref to null specifically on the query's next *success*
(not merely on a changed error timestamp/identity) — otherwise identical failures
across retries spam duplicate toasts, and a real success won't re-arm the toast for
a later, possibly-different failure.
