---
name: Artifact port config source of truth
description: How dev/prod ports are actually resolved for managed artifact workflows (api-server)
---

Managed artifact workflows inject `PORT` from `.replit-artifact/artifact.toml` (`localPort`) at runtime; the `[workflows]` text in `.replit` can show stale values and is NOT authoritative.

**Why:** After changing api-server's localPort via `verifyAndReplaceArtifactToml`, `.replit` still showed the old port but the restarted workflow bound the new one and health checks passed.

**How to apply:** To change an artifact service port, edit only `artifact.toml` through `verifyAndReplaceArtifactToml` and restart the workflow — don't fight `.replit`. Production port comes from `[services.production.run.env] PORT` in the same toml (deploy waits on that port). api-server dev now runs `scripts/free-port.mjs` before start to kill stale own instances holding the port, and `src/index.ts` has SIGTERM/SIGINT graceful shutdown + EADDRINUSE retry.
