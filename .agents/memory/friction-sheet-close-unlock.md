---
name: Dismissed overlay still swallows touches
description: Why a closed-looking bottom sheet leaves the screen unresponsive — outer container geometry and RN hit testing, not state gates or thread contention.
---

# A dismissed overlay can still eat every touch

When a sheet/overlay animates out by moving an **inner** layer (translate) while
its **outer** absolutely-positioned container keeps its full open height until
unmount, the container goes on occupying that region of the screen for the whole
animation.

React Native hit testing stops at the topmost view under the touch point. A
plain `View` with `pointerEvents:"auto"` swallows the touch **even with no
background color and no touch handlers** — it does not fall through to sibling
views rendered behind it. The overlay looks gone but still blocks anything
beneath it.

**Rule:** if a dismissal animation moves an inner layer, make the outer
container `pointerEvents="none"` the moment closing begins. Drive it from the
caller's "is open" flag rather than adding overlay-local state.

**Why:** the container's geometry is unchanged during close, so hit testing is
the only thing separating "looks closed" from "behaves closed".

**How to apply:** when a dismissed overlay leaves the screen feeling locked,
inspect the geometry and `pointerEvents` of every still-mounted ancestor before
theorizing about state gates or JS-thread contention. Both are seductive
alternative explanations — here the reader's gestures ran via `runOnJS`, which
made "JS thread saturated by close-path re-renders" sound right and cost a wasted
fix. Confirm which layer actually receives the touch.

## Corollary: restoring interaction early creates a reopen race

Once the screen becomes usable before the animation ends, the user can reopen
while the overlay is still closing. Two silent failures follow: a `visible` prop
that never transitions false→true (so the open effect never runs), and the
in-flight close's completion callback tearing down the session just requested.

Handle both with a nonce that re-triggers the open effect and a session token
that invalidates a superseded close callback. Do **not** gate cleanup on the
animation's `finished` flag — cancellation is normal, and a cancelled but
legitimate close must still clean up.
