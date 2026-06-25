---
name: Friction envelope opening animation
description: Layer model & flap-swap design for the sealed-envelope (편지 봉투) open animation in CardSelectOverlay
---

# Sealed envelope (편지 봉투) opening animation

Lives in `components/CardSelectOverlay/CardSelectOverlay.tsx` (`renderEnvelopeLayer`)
+ `components/EnvelopeCard/EnvelopeLayers.tsx`. Driven by a detail guide + mockup PNGs the user supplies.

## Layer model (z-order bottom→top)
inside → open flap → letter card → pocket → closed flap → cover.
**Why:** guide specifies (after the body flips, excluding cover, from TOP): closed flap, pocket, card, open flap, inside. The open flap MUST sit below the card so the sliding body never covers the card.

## Flap swap (the non-obvious part)
- Closed flap **rotates** (rotateX, hinged at the card's TOP edge) and fades out exactly at the edge-on instant (~0.536 progress, = -90° of a 0→-168° range).
- Open flap is **static** (no rotateX) — drawn in its final opened orientation — and fades in at the same instant.
**Why:** the swap is invisible because the closed flap's projected height ≈ 0 at -90°. Rotating the open-flap artwork (which is drawn as a finished opened state, seal near top) would flip its orientation and look wrong; keep it static.

## Asset conventions
- Mockup PNGs are used directly as full-card-sized layers (resizeMode "stretch"); wax seal is **baked into** both flap images (no separate seal overlay).
- Full-card artwork is ratio 1.6 (= cardRatio 8/5). The open-flap art is shorter (1.324) → anchor it to top:0 with its own aspect.
- Top-edge hinge for a full-card flap: container height CARD_H, transform [translateY(-CARD_H/2), rotateX, translateY(CARD_H/2)].
