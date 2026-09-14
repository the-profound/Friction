---
name: CanonicalCardSlot radius and clip ownership
description: Why a scaled-down cover in CanonicalCardSlot can look flatter than neighbors and show a rectangle sliver at its corners.
---

# CanonicalCardSlot: shadow and rounded clipping need separate boundaries

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

When the projected card needs a shadow, one node cannot safely own both the
shadow and `overflow:"hidden"`: iOS clips the shadow to the slot and makes the
card look flat. Use an unclipped outer boundary for layout, shadow, and the
shared press transform, with a same-sized rounded clip nested immediately
inside it. The canonical projection stays inside that clip.

**Why:** clipping the shadow removes it on iOS, while putting shadow on an
opaque sibling can expose a duplicate card and Android elevation can change
sibling paint order. Nesting the clip inside the real shadow-bearing container
avoids all three problems.

**How to apply:** keep the outer slot `overflow:"visible"` and apply any shadow
token there exactly once; disable the projected card's own shadow in that case.
Keep the radius on both the outer shadow geometry and the same-sized inner clip.
Apply press scale only to the outer boundary so shadow, clip, and content move
as one unit. Callers needing a different visual corner ratio should continue to
pass an explicit final-size radius.
