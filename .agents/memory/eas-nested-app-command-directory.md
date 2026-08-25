---
name: EAS nested-app command directory
description: Prevent EAS release commands from discovering a stale root Expo config in a nested mobile artifact workspace.
---

Run every EAS command that discovers project configuration from the mobile artifact directory, including environment inspection commands such as `eas env:exec`, not only `eas build`.

**Why:** EAS resolves the Expo project from its current working directory. In a monorepo, a root-level `app.json` can be selected before the nested app's `app.config.js`, causing misleading project-ID or slug errors even when the app configuration is correct.

**How to apply:** In reusable release helpers, derive the app directory from the helper's own file location and change into it in a subshell before calling EAS. Likewise, resolve repository files in Node release checks from the script path rather than `process.cwd()`, because EAS lifecycle hooks may run from the workspace root.