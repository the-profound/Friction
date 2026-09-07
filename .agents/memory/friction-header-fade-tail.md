---
name: Friction header fade-to-transparent tail
description: Pattern for turning a solid PageHeader/filter-bar background into a top-opaque→bottom-transparent gradient that reveals scrolled list content underneath, and where NOT to attach it.
---

`components/NavBar/PageHeader.tsx` exports `HeaderFadeTail` (+ `HEADER_FADE_HEIGHT` constant) and a `PageHeader` `fadeBottom` prop: a `LinearGradient` from opaque to fully transparent, meant to overlay the top of the scrollable list below a header/control row so scrolled content fades in/out instead of hard-cutting.

**Why this shape:** the reveal only works where the transparent-gradient region visually overlaps real scrolled content (not blank padding, not the plain screen background). If the fade region sits entirely above where content starts, nothing is revealed and the transition looks like a hard cut even though a "gradient" technically rendered somewhere.

**Do NOT use negative-margin sibling overlap (`marginBottom: -H` + `zIndex`) to make the fade paint over a `FlatList`.** On a real device (confirmed independently in both of.tsx and on.tsx, each with their own from-scratch implementation) this produced a visible hard cut instead of a fade — the negative margin does not reliably make the earlier sibling's content paint on top of the FlatList's own compositing layer. Use **absolute positioning** instead: give the FlatList/empty-state containers `paddingTop` equal to the control row's real content height (reserving its layout space), then render the fading row as a `position: "absolute", top: 0, left: 0, right: 0` overlay as the LAST sibling in the same relatively-positioned parent — later-in-tree absolute siblings reliably paint on top in RN, unlike zIndex+negative-margin overlap.

**Gradient layer implementation:** put the `LinearGradient`/`Gradient` with `style={StyleSheet.absoluteFillObject}` (never given its own explicit height as a sized flex container — unverified whether that variant reliably paints as a real gradient on device) as one child of the absolute overlay box, with the real row content (buttons etc.) as a sibling on top. Multi-stop `colors`+`locations` (e.g. `[0, 0.55, 1]`) give a softer curve than a plain 2-stop fade.

**Touch handling:** every layer of the overlay (outer absolute box, the gradient, the row content wrapper) must use `pointerEvents="box-none"` except the gradient itself (`pointerEvents="none"`) — this lets taps pass through the transparent/faded area to the list below while the row's own buttons stay tappable. A button with its own opaque surface+shadow stays legible regardless of the row's background transparency.

**Why NOT to just attach `fadeBottom` to every `PageHeader` call directly:** if an active UI control (kebab/menu row, filter row, search bar) sits between the header and the scrollable content, the fading white layer visually washes out that control instead of just fading scrolled content. Only use `fadeBottom` on `PageHeader` when nothing sits between it and the real scrollable content.

**Verification limitation:** the (tabs) routes are Supabase-auth-gated in this dev environment with no working dev quick-login, and the web preview is separately blocked by a font-loading hang (see friction-web-preview-font-boot-hang.md), so this fade behavior cannot be confirmed via the Screenshot tool — real-device screenshots from the user are the only way to catch a hard-cut regression here.
