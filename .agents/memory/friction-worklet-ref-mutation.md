---
name: Worklet ref mutation silently ignored
description: Reanimated worklets cannot mutate React refs captured from JS; writes are dropped with only a WARN.
---

**Rule:** Never write `someRef.current = x` inside a Reanimated worklet (withTiming/withSpring completion callbacks, gesture handlers without `.runOnJS(true)`). The ref object is deep-copied to the UI runtime; writes mutate the copy and are silently dropped — Metro logs only `WARN [Worklets] Tried to modify key 'current' of an object which has been already passed to a worklet`.

**Why:** In the question-card pager, transition completion callbacks mutated `ptrRef/seqRef/savedRef` on the UI thread. React state updated via runOnJS but JS-side refs stayed stale, so every next swipe computed from old state — cards "snapped back" to the same question and back-swipe seemed blocked. Symptom looked like animation/state bugs; real cause was dropped ref writes.

**How to apply:** Commit all ref + state updates in a single plain-JS function (stable useCallback) and call it via one `runOnJS(commitFn)(args)` from the worklet callback. Gesture handlers with `.runOnJS(true)` run on the JS thread and may mutate refs freely. When debugging "state resets after animation," grep Metro logs for the Worklets WARN first.
