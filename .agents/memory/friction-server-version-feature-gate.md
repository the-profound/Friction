---
name: friction server version/feature gate
description: How the app detects a stale deployed API server (missing routes/features) and shows one unified mismatch notice. Read before adding a new server capability that must be gated by version, or before changing GET /api/version.
---

# Server version/feature mismatch detection

## Why this exists
Native builds point at the deployed API server; the web preview points at the dev server.
When a route/feature ships in code but the deployed server hasn't been redeployed yet,
native silently 404s on that route while web works fine — this previously surfaced only as
scattered, unexplained per-feature failures with no clear cause.

## The mechanism
- Server: `GET /api/version` (`artifacts/api-server/src/routes/health.ts`, unauthenticated,
  no sensitive data) returns `{ buildId, features }`. `features` is a manually-maintained
  array of string literals (`SUPPORTED_SERVER_FEATURES`) naming capabilities the *currently
  running* server actually supports — not every route, just ones worth gating on.
- Spec: `ServerFeature` enum + `ServerVersion` schema in `lib/api-spec/openapi.yaml`.
- Client: `artifacts/friction/lib/serverVersionCheck.ts` holds `REQUIRED_SERVER_FEATURES`
  (pure logic, no RN/React imports) — the features *this build of the app* needs. It is
  evaluated once at startup by `components/ServerVersionGate/ServerVersionGate.tsx`
  (mounted once in `app/_layout.tsx`), which shows one unified "app/server version
  mismatch" notice if any required feature is missing, or if `/api/version` 404s (old
  server, route didn't exist yet).

## The footgun: two lists, kept in sync by hand
`SUPPORTED_SERVER_FEATURES` (server) and `REQUIRED_SERVER_FEATURES` (client) are
independent hand-maintained lists that must name the same capabilities. Nothing enforces
this automatically.

**Why:** they live in different packages (api-server vs. the friction app) and reference
different concerns (what the server *provides* vs. what the app *needs*) — a shared
generated list isn't a natural fit yet with only one caller.

**How to apply:** when a new client feature depends on a specific server capability that
could plausibly be missing after a stale deploy, add the same string to both
`ServerFeature` (openapi.yaml, drives codegen), `SUPPORTED_SERVER_FEATURES` (health.ts),
and `REQUIRED_SERVER_FEATURES` (serverVersionCheck.ts). Forgetting the client side means
the gate never protects that feature; forgetting the server side means the gate always
reports it missing.

## Distinguishing "old server" from "network blip"
`evaluateServerVersionError()` only classifies a **404 on `/api/version` itself** as a
version mismatch (the route didn't exist on that deployment yet). Any other error
(timeout, 500, network failure) resolves to `"unknown"`, not `"mismatch"` — deliberately,
to avoid mislabeling ordinary connectivity issues as a version problem.
