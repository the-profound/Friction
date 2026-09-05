---
name: Router-level UUID guard for path IDs
description: How to stop a resource router from 500ing on malformed/unregistered path IDs, and the test-fixture trap it creates.
---

Problem: a resource router (e.g. `spaces.ts`) that does `eq(table.id, req.params.id)` without validating shape will throw when the ID isn't a UUID — including when the actual cause is an unmatched, unregistered route falling through to `/resource/:id` (stale client build calling an endpoint the running server doesn't have yet). This surfaces as an HTML 500, not a JSON 404.

Fix: `router.param("id", (req, res, next, value) => { if (!UUID_REGEX.test(value)) return res.status(404).json(...); next(); })` on the same Express router. Verified empirically (Express 5): the param callback fires before any route-specific middleware, including `requireAuth` — so bad-shaped IDs 404 even on authenticated sub-routes, without needing auth to run first. Registration order relative to the routes using `:id` does not matter; `router.param` applies to all matching routes on that router regardless of where in the file it's declared.

**Why:** Deployed clients and servers drift (new client route ships before the API deploy); without this guard, every such mismatch is an alarming 500 instead of an unremarkable 404.

**How to apply:** Add the param guard once per router, near its `const router = Router()` declaration. Before doing so, grep the router's own test files for the fake IDs used in test fixtures (e.g. `"space-a"`, `"letter-1"`) — mocked-DB unit tests routinely use human-readable non-UUID fixture IDs in the URL path, and adding a real UUID-format guard will break all of them with 404s. Replace those fixture IDs with valid UUID-shaped strings (e.g. `"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa"`) everywhere they appear (URL path, matching DB row `id`/foreign-key fields) before adding the guard, then rerun the full suite.

This exact vulnerability (non-UUID ID crashing the DB query) was also observed live in `thoughts.ts`; likely present in any other router with the same `eq(table.id, req.params.id)` pattern and no shape check.
