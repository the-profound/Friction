---
name: Dansang sheet → letter page shrink
description: Fit-and-center transform for shrinking the reader card into the space above the Dansang sheet; measured positions, not assumptions.
---

## Rule
When the Dansang sheet opens, the letter card must **move up and shrink to fill the available area above the sheet** (fit & center) — NOT stay top-anchored at its original position with only the bottom rising. The user explicitly rejected top-anchor behavior (card left a large empty gap at top and was covered by the sheet).

**Why:** Product intent (red-pen sketch from user): card occupies the region from just below the top safe area to just above the sheet top.

**How to apply:**
- Available area: `[insets.top + 8, sheetTop - 12]` where `sheetTop = screenHeight * (1 - PANEL_RATIO)`; the sheet is absolutely positioned `bottom: 0` in the same window, PANEL_RATIO lives in DansangBottomSheet (0.58 — keep the read-screen constant in sync).
- `scale = min(1, availHeight / frameHeight)`; `translateY = availCenterY - cardCenterY`.
- **Transform order matters:** `[{translateY}, {scale}]` — translate first so it moves in parent (unscaled) pixels, then scale around the moved center. Putting scale first makes the translation get scaled.
- **Never derive the card's original top analytically.** Wrap the card in a non-transformed View (`collapsable={false}`) and `measureInWindow` on layout; analytic center is only a pre-measurement fallback. Assumption-based formulas failed on device three times.

## Side effect: parked prev slot becomes visible
When the wrapper scales down, the parked prev slot (translated offscreen left) can enter the visible strip. Fix: shared value synced to `isDansangOpen`, `opacity: 0` on the prev slot while the sheet is open (slot is unreachable then).
