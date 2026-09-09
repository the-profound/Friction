---
name: Notion connector proxy versioning
description: Header ownership and retry-marker safety for file-based Notion publishing through Replit's connector proxy.
---

When using Replit's authenticated Notion connector proxy, do not set
`Notion-Version` in application code. The connector contract injects the
compatible version itself.

**Why:** The installed connection's generated setup instructions explicitly say
the proxy injects `Notion-Version: 2022-06-28` and callers must never set it.
Setting another version can make the legacy database/query payload contract
inconsistent with the proxy.

**How to apply:** Send only content-type and request payload headers through
`ReplitConnectors.proxy("notion", ...)`. For multi-batch publishing, keep a
pending marker until all body writes succeed, then promote it to the final hash
so retries repair partial pages.