---
name: Guarded native removal ownership
description: How asynchronous save boundaries should complete React Navigation native removal actions without duplicate transitions.
---

When `usePreventRemove` intercepts a native or browser removal, preserve the callback's exact `data.action` and dispatch that same action after the local durability boundary completes. Do not replace it with a newly created `router.back()` when the original destination is valid.

**Why:** React Navigation annotates the prevented action so replaying it can pass the same guard exactly once. Disabling the guard and scheduling a fresh back action can race the completed iOS edge gesture, briefly restore the discarded screen, and trigger a second transition.

**How to apply:** Keep header and Android-initiated exits on the explicit guarded-navigation path, but let intercepted native/browser removals own their original action. Hold one synchronous exit lock through export and local persistence, reject repeated inputs, and invalidate deferred callbacks when the screen unmounts.

An in-place stage or entity route replacement is not a permanent exit. Re-arm
the removal guard and open a fresh ownership session after that replacement
commits, because Expo Router may preserve the same mounted screen instance.

**Why:** A one-shot committed session left attached to a reused route silently
rejects every later header, hardware, browser, or edge-swipe exit.

**How to apply:** Mark same-screen replacements separately from true exits. Only
same-screen replacements reset the session and guard after dispatch; true exits
remain permanently committed until unmount.