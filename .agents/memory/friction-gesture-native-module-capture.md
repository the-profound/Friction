---
name: Friction gesture native-module capture
description: Prevent fatal Reanimated serialization errors caused by React Native native-module objects in gesture closures.
---

**Rule:** A Reanimated gesture callback must never directly reference, or call a function that closes over, a React Native native-module object such as `Keyboard`.

**Why:** Reanimated can serialize gesture closures before honoring a gesture's JS-thread setting. A native module object is not transferable to the UI runtime and can raise a fatal “Cannot copy value” error that aborts the app.

**How to apply:** Let gestures emit only serializable state or callback requests. Perform native-module work in an ordinary React effect or another clearly JS-only path outside the gesture closure. Apply this even to gestures configured with `runOnJS(true)`.