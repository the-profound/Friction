---
name: Unauthenticated auth diagnostics
description: Privacy boundary for mobile auth-flow telemetry accepted before a user is authenticated.
---

Treat every field received by an unauthenticated diagnostic endpoint as hostile, including fields that a typed mobile caller normally fills with constants.

**Why:** A basic string schema or character regex lets any caller inject email addresses, tokens, raw exception text, or other sensitive values into durable operator logs. Client TypeScript types are not a trust boundary.

**How to apply:** Use finite server-side allowlists for event names, outcomes, and error classes. Generate opaque correlation IDs in a fixed, recognizable format and validate that exact format before logging. Omit nonessential free-form metadata, reject malformed events, and keep error responses to stable classification codes rather than raw upstream or database details.

For reachability diagnostics, any explicit nonzero HTTP status means the request reached a service; classify transport failure before text heuristics only when no HTTP response exists (or status is zero).

**Why:** An API response body can contain words such as “network” or “timeout”; treating that text as a connection outage misdirects operators away from a reachable, failing service.

**How to apply:** Give stable server error codes first priority, then inspect an explicit status, then use error name/message only for response-less transport failures.