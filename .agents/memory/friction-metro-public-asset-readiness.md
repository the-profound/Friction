---
name: Metro public asset readiness
description: How Friction development servers prove native assets are downloadable from device-facing origins
---

Development bundle metadata is not proof that a physical device can download a
Metro asset. Read each asset's live metadata from the generated platform bundle,
construct the same URL the native resolver uses, and download the exact bytes
from both localhost and every public origin before declaring the shared launcher
ready. Verify the file signature and content identity, not only HTTP 200.

**Why:** Replit preview and fixed-tunnel routing can fail independently from
Metro's local bundle generation. A metadata-only localhost check allowed native
WebView fonts to fail after startup had already appeared healthy.

**How to apply:** Keep preview and tunnel on the same Metro launcher and pass its
device-facing origin into asset validation. A fixed tunnel must be opened before
the launcher waits for public validation; opening it afterward creates a
circular readiness wait. Runtime asset loads still need bounded retries and an
atomic fallback because a device request can fail after startup validation.