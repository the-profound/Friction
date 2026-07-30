---
name: Question card deck — single continuous pos pipeline
description: Reader question cards were rewritten as a unified deck driven by one shared value; why dual render trees fail.
---

**Rule:** For swipeable card decks, never use two render trees (static layout + transition overlay). Drive every card from ONE shared value `pos` (float, card units): card idx renders at `(idx - pos) * slotOffset` with X peek interpolated from `|idx - pos|`. Drag mutates `pos`; release runs `withTiming` to the exact integer target (monotonic bezier — no overshoot); the completion commit only updates the React `cursor` state — `pos` already equals the target, so nothing is reset and nothing snaps.

**Why:** The previous design swapped a static tree for an animation overlay on every transition. The swap caused: placeholder/text popping in at the end, shadows re-appearing, peek cards overshooting then snapping to their parked spots, and blinking of the incoming card. Users notice all of it. The unified pipeline eliminates the whole failure class because cards are always mounted with identical structure (question Text + TextInput with built-in placeholder, editable only when `idx === cursor`).

**How to apply:** In `QuestionCardCurl.tsx`: state is `answers: Record<qIdx, string>` + `cursor`; render window is `cursor ± 2`. Keep drag damping multipliers (up 0.10; down 0.12 / first-card resistance min(0.22dy, 0.28·rest)) and THRESHOLD 80, SLIDE_DURATION 380, bezier(0.25,0.46,0.45,0.94). Commit must run via runOnJS regardless of `finished`.
