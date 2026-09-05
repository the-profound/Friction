---
name: CanonicalCardSlot radius and clip ownership
description: Why a scaled-down cover in CanonicalCardSlot can look flatter than neighbors and show a rectangle sliver at its corners.
---

# CanonicalCardSlot: outer view must own radius + clip, not the scaled inner content

`CanonicalCardSlot` (`artifacts/friction/components/ArticleCardItem/CanonicalCardSlot.tsx`)
renders `ArticleCardItem` at its canonical size (`Sizing.cardSlotW`/`cardH`) and shrinks it
with `transform: [{ scale }]` into a smaller slot, so the card never recomputes
typography/padding/radius from a tiny `cardWidth`.

Two related visual bugs come from this pattern:

1. **Flatter-looking corners in tight carousels.** The canonical card's own
   radius (16px at `Sizing.cardSlotW`) shrinks proportionally with the
   transform, giving a fixed `16/300` radius-to-width ratio regardless of the
   final slot size. Neighboring plain placeholder cards in the same carousel
   often use their own fixed radius (e.g. 14px) tuned to the slot's actual
   width, which is a *different* (usually larger) ratio — so the cover reads
   as less rounded than its siblings even though nothing is technically wrong.
2. **A rectangular sliver behind the rounded corners.** The card's shadow
   (`overflow: "visible"` on `ArticleCardItem`'s `cardSurface`, by design, so
   the shadow isn't clipped mid-card) extends into the sharp-cornered gap
   between the rounded card and its bounding box. If the outer wrapper clips
   with a plain rectangle (no radius) sized exactly to the content, that
   corner triangle of shadow/background is included in the clip and reads as
   a hard-edged rectangle poking out from the rounded corner.

**Why:** both bugs stem from the outer wrapper only ever using
`overflow: "hidden"` with no radius of its own, i.e. clip shape and clip size
came from the inner scaled content lining up "by construction" rather than
being asserted explicitly.

**How to apply:** `CanonicalCardSlot` takes an optional `borderRadius` prop
applied to the **outer** view (which owns the final radius + clip), defaulting
to the old `16 / Sizing.cardSlotW` ratio so existing callers (of.tsx, to.tsx,
user-profile grids, of-01-detail.tsx) keep their look unchanged. Any caller
whose slot sits beside sibling cards using a different radius ratio (e.g. the
space-detail round carousel's placeholder slots, `SC_SLOT_RADIUS = 14`) should
pass that ratio explicitly so the cover's rounding matches its neighbors, and
so the shadow's corner triangle gets clipped away instead of showing through.
