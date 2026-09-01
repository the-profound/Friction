---
name: Friction WebView body-font readiness
description: How native letter WebViews must receive and synchronize Eulyoo and fallback fonts
---

# Native WebView body fonts are isolated from app fonts

Fonts registered at the React Native app level are not automatically visible to
native WebView documents. Every font in the letter-body fallback chain must be
embedded into the WebView document, and each data URI MIME/format declaration
must match the actual bundled file type.

**Why:** A CSS family name can appear correct while the WebView silently lacks
that face. Missing Eulyoo glyphs then fall through to an unintended system font
or a broken glyph, and measuring before the embedded fallback decodes produces
page boundaries that differ from displayed text.

**How to apply:** Treat editor, reader, and hidden measurement WebViews as one
font contract. Publish all required weights atomically, wait for
`document.fonts` with a bounded failure path before content or measurement, and
invalidate prior measurements whenever the embedded font configuration changes.
Do not trust `document.fonts.load()` alone: a font can advertise a cmap entry
whose glyph has no outline. Sanitize those mappings in WebView assets and verify
both a primary glyph and a fallback-only glyph by comparing non-empty canvas
rasters for every weight. Native consumers should accept custom mode only when
the complete face-load and glyph-selection result is explicitly verified;
otherwise switch the shared session-sticky mode to system serif.