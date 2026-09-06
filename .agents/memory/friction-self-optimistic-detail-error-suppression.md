---
name: Self-initiated optimistic status patch vs. detail-resolution error
description: A screen's own optimistic cache patch before navigating away can make resolveDetailEntity see its own record as invalid; how to suppress only that false positive without breaking real-error detection.
---

A detail screen that derives its error/loading/success state entirely from server data can misclassify itself: if a stage-transition handler optimistically patches this screen's own record status right before navigating away, the still-focused screen re-renders in between with the new status and briefly sees its own record as no longer valid for this screen — a false "not found"/invalid-state error, even though nothing is wrong.

**Why:** the optimistic patch and the error classification are two independently-correct pieces of logic that only conflict during the brief in-between render before the route change lands. There is no way to tell "I made this change on purpose and am leaving" from "this record is genuinely invalid here" just by looking at the data.

**How to apply:** track "a self-initiated transition is pending" as its own explicit, narrowly-scoped flag (not a general in-flight/navigating flag many unrelated handlers share) and thread it into the error-resolution logic as an explicit opt-in — never suppress genuine query failures, only the one specific misclassification the self-patch causes. Two correctness traps to check for:
1. The flag must take effect synchronously before the optimistic patch, so the very first affected render already suppresses — not one tick later.
2. Clearing the flag on screen focus (covers both "returned here" and "transition failed/aborted") must *also* force a fresh render if the flag was mutated outside React state (e.g. a plain ref/controller) — otherwise the screen can stay stuck showing whatever was last rendered while suppressed, silently breaking real-error detection on return. Prefer a small pure state-machine object for the flag so its begin/clear lifecycle is unit-testable independent of any component render harness.
