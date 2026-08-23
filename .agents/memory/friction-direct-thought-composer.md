---
name: Friction direct thought composer
description: Preventing duplicate preliminary-thought creation across global and in-page entry points.
---

All direct “new thought” affordances must use the same creation coordinator and
its synchronous in-flight lock. Keep a short post-settlement duplicate-tap
window before releasing the lock.

**Why:** Separate mutation hooks made controls that appeared together able to
create duplicate preliminary thoughts. A very fast failed request can also
settle between two events in a physical double tap, releasing a simple
in-flight lock too early.

**How to apply:** When adding a direct (not quote/reading-derived) thought
entry point, route it through the shared composer rather than calling the
create mutation locally. Bind its disabled/busy state to the shared state so
all visible controls agree.