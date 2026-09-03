---
name: Guarded native removal ownership
description: How asynchronous save boundaries should complete React Navigation native removal actions without duplicate transitions.
---

When `usePreventRemove` intercepts a native or browser removal, preserve the callback's exact `data.action` and dispatch that same action after the local durability boundary completes. Do not replace it with a newly created `router.back()` when the original destination is valid.

**Why:** React Navigation annotates the prevented action so replaying it can pass the same guard exactly once. Disabling the guard and scheduling a fresh back action can race the completed iOS edge gesture, briefly restore the discarded screen, and trigger a second transition.

**How to apply:** Keep header and Android-initiated exits on the explicit guarded-navigation path, but let intercepted native/browser removals own their original action. Hold one synchronous exit lock through export and local persistence, reject repeated inputs, and invalidate deferred callbacks when the screen unmounts.