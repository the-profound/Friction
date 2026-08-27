---
name: Friction cover shadow ownership
description: The safe layer model for letter-cover press and hero transitions.
---

Letter covers must have one visible card surface. That surface owns the
background, rounded geometry, and platform shadow/elevation; do not render an
opaque same-sized view solely to cast the shadow.

**Why:** A backing shadow host can be exposed when the cover is pressed,
scaled, handed off to the selection modal, or still preparing its image. It
then reads as a white duplicate card rather than a shadow.

**How to apply:** Keep the structural press wrapper transparent and place the
cover inside one surface. A card opening from the restrained carousel must
derive its shadow treatment from the same hero progress used for the
source-to-overlay transition, so open and close return to the matching
carousel shadow without adding a second opaque layer. Put Android elevation on
that containing surface, never on an elevated sibling; do not add clipping to
the scaled card subtree.

For a photo-cover handoff on native, retain a stable image source identity and
wait one animation frame after its display event before hiding the source card.

**Why:** The native image display callback can precede the frame in which the
modal surface is actually composited. Hiding the source in that interval
exposes the neutral card background, even when the photo URL is already cached.

**How to apply:** Let the overlay's existing session/slot/URL readiness gate
reject stale callbacks. Its accepted callback should be delivered only after
the next frame, while the source card remains visible; do not re-create the
image source object merely because hiding that source causes an ancestor
render.