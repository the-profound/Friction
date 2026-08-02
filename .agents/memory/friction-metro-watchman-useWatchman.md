---
name: Friction Metro Watchman opt-in
description: Why installing Watchman alone doesn't make Metro use it, and how running two Metro instances in this monorepo hits inotify ENOSPC.
---

`@expo/cli`'s Metro file-map fork reads `config.resolver.useWatchman ?? false` — it does **not** inherit Metro's own default of `true`. So even with the Watchman binary installed and on PATH, Metro silently uses Node's per-directory `fs.watch` (`FallbackWatcher`) unless `metro.config.js` explicitly sets `config.resolver.useWatchman = true`.

**Why it matters:** `FallbackWatcher` needs roughly one inotify watch per directory, same order of magnitude as Watchman, but each Metro process gets its *own* independent set — so N concurrent Metro instances (e.g. main preview + a tunnel workflow) multiply watch usage by N. Watchman runs as a single daemon shared by all clients, so concurrent Metro instances reuse the same watch set instead of duplicating it. In this pnpm monorepo, one Metro's full tree needs ~47k inotify watches, close to the container's fixed `fs.inotify.max_user_watches=65536` (not raisable — `sysctl -w` is permission-denied in this sandbox), so two FallbackWatcher instances always blow the ceiling.

**How to apply:** When adding a second Metro/Expo process (tunnel scripts, CI, etc.) in a pnpm monorepo on Replit, don't just install Watchman — grep the app's `metro.config.js` for `resolver.useWatchman` and set it to `true` explicitly. Verify with `watchman watch-list` (should show the workspace root) and by summing `grep -c "^inotify wd:" /proc/<pid>/fdinfo/*` across processes — total must stay under 65536.
