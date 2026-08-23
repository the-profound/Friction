---
name: Unauthenticated auth diagnostics
description: Privacy boundary for mobile auth-flow telemetry accepted before a user is authenticated.
---

Treat every field received by an unauthenticated diagnostic endpoint as hostile, including fields that a typed mobile caller normally fills with constants.

**Why:** A basic string schema or character regex lets any caller inject email addresses, tokens, raw exception text, or other sensitive values into durable operator logs. Client TypeScript types are not a trust boundary.

**How to apply:** Use finite server-side allowlists for event names, outcomes, and error classes. Generate opaque correlation IDs in a fixed, recognizable format and validate that exact format before logging. Omit nonessential free-form metadata, reject malformed events, and keep error responses to stable classification codes rather than raw upstream or database details.