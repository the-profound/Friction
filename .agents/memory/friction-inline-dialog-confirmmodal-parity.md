---
name: Inline dialogs inside CardSelectOverlay match ConfirmModal by hand
description: Dialogs rendered via CardSelectOverlay's inlineModal prop cannot reuse ConfirmModal directly; their tokens/behavior must be copied and kept in sync manually.
---

# Inline dialogs inside CardSelectOverlay's Modal

`CardSelectOverlay` exposes an `inlineModal` prop specifically because a
second native RN `Modal` cannot guarantee z-order above an already-presented
one on all platforms — so confirm/info dialogs that need to appear above the
letter-selection overlay must be plain `View`-based content rendered inside
CardSelectOverlay's existing Modal, not a second `<ConfirmModal>`.

**Why:** this means such dialogs can't just import and render
`components/ConfirmModal/ConfirmModal.tsx` — they need their own local
component/styles that manually mirror it (colors, typography, spacing, card
radius/padding, button height/gap, backdrop dim) plus its two UX details:
fading in/out (not popping) and freezing the last real title/description/
button labels while fading out so closing never flashes empty content.

**How to apply:** when building a new inline dialog for CardSelectOverlay (or
auditing an existing one, e.g. `useLetterSelectionOverlay.tsx`'s
`InlineConfirmDialog`), copy ConfirmModal's exact style values rather than
approximating them, and replicate the frozen-ref pattern from
`ConfirmModal.tsx` (freeze title/description/labels while `visible`, read the
frozen values while animating out). There is no shared component to import —
this is a deliberate duplication forced by the z-order constraint, so treat
divergence as a bug when reviewing changes to either file.
