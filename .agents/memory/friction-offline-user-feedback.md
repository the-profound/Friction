---
name: Friction offline user feedback via onlineManager
description: How to give screens visible offline feedback on top of React Query's default (silent) offline pausing.
---

# Offline feedback needs an explicit reactive signal

React Query's default online mode pauses requests rather than rejecting them.

**Why:** awaiting an offline refetch can leave controls visibly stuck, and a
paused initial query may be pending without being loading.

**How to apply:** use the app-wide online manager for action feedback. Render
cached data whenever it exists; when no data exists, distinguish a paused
pending query from a confirmed empty response.
