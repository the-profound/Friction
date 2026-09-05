---
name: Fixed-width item cap inside a stretched flex row
description: Why a row of N equally-sized items can show an asymmetric right-side gap even though it looks "left aligned" and centered layout logic was never touched.
---

## The bug pattern

A row container (`flexDirection: "row", justifyContent: "flex-start"`) sized items by
`Math.min(<hardCap>, Math.floor((availableWidth - totalGap) / N))`. The row itself had no
explicit width and sat inside a `flexDirection: "column"` parent with default
`alignItems: "stretch"`, so the row silently stretched to the parent's full content width
regardless of how wide its children actually were.

As long as the hard cap never binds, `N * itemWidth + gaps === availableWidth` and the row's
right edge lines up with the same padding as the left edge — looks fine. The moment the cap
binds (which happened even on ordinary phone widths here, not just tablets/web), the items
stop filling the row, but the row container is still stretched to `availableWidth`. The
leftover space renders as an empty gap after the last item, which reads as "the right margin
is bigger than the left margin" even though no margin/padding value actually changed.

**Why:** the natural per-item width computed as a whole-width division was, in the case this
was found, larger than the hard cap at typical mobile screen widths (not just unusually wide
ones), so the cap was live in the common case, not an edge case — making the visual bug appear
on ordinary devices.

**How to apply:** when a fixed-size cap is layered on top of "divide available width evenly
into N items," check whether the cap actually binds at realistic screen widths before assuming
the layout is fine. If a group of same-row items must look symmetric relative to the
container's padding, either (a) drop the arbitrary cap and let the items fully divide the
available width (consistent with other uncapped N-column grids elsewhere in this codebase),
or (b) make the row's actual rendered width match its content (`alignSelf: "flex-start"`) *and*
choose a fill strategy that avoids leftover trailing space — capping alone does not fix the
optics, since the empty space is there either way, just invisible until you look for the
misaligned right edge against other reference elements (e.g. a header icon's right edge).
