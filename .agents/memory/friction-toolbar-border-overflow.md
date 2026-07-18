---
name: RN border + overflow:hidden clipping
description: borderWidth on a Pressable/View that has overflow:"hidden" gets clipped and can hide inner content (icons)
---

Rule: never combine `borderWidth` with `overflow: "hidden"` on the same RN view (e.g. round toolbar buttons). The border is clipped away and the inner content (icon/text) can become invisible on iOS.

**Why:** MemoToolbar B/I/U/quote active state as a red outline circle failed twice — border invisible, then icons invisible — until `overflow: "hidden"` was removed from the button style. Buttons without a fill background don't need clipping at all.

**How to apply:** for outline-style active states on capsule/circle buttons, drop `overflow: "hidden"` and rely on `borderRadius` alone; keep `overflow: "hidden"` only where a filled background must be clipped.
