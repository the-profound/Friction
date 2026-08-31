---
name: Friction Metro watcher stability
description: How to keep concurrent Friction Metro servers stable when Watchman is unavailable and Replit state directories change during cold startup.
---

Keep the explicit Watchman opt-in, but do not assume the binary is present. When
Metro falls back to Node watchers over the workspace root, exclude transient
Replit state directories from the file map.

**Why:** Replit creates and removes workflow-log directories while a cold Metro
file-map crawl is running. FallbackWatcher can treat a directory disappearing
mid-crawl as fatal (`ENOENT`) even though it is unrelated to app source. Two
Metro processes also multiply fallback watcher pressure when Watchman is absent.

**How to apply:** For any workspace-wide Metro watch, retain the Watchman opt-in
and block non-source Replit state (especially `.local`). Verify a truly
cold-cache start with the main preview and tunnel running concurrently; do not
infer Watchman use from configuration alone.
