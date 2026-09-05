---
name: Scroll boundary gesture origin
description: How to classify a gesture that begins at a scroll boundary without losing it to intervening scroll updates.
---

Classify a boundary-only gesture using the offset captured when the gesture begins, not the current offset when it ends. Wheel input without a drag session may use the current offset immediately before applying the delta.

**Why:** Scroll callbacks update live offset state while a drag is in progress. Rechecking that live state on release rejects the exact gesture being detected because a valid drag has already moved the content away from the boundary.

**How to apply:** Capture boundary eligibility alongside pointer/touch-down or scroll-begin-drag. Pass that captured origin into the shared decision function, and separately reject fast flicks using release velocity.