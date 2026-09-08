---
name: Friction Markdown emphasis boundaries
description: Emphasis delimiters can be escaped at paragraph boundaries and must be normalized before the next editor or reader parser.
---

WYSIWYG editor exports must normalize only flanking escapes around `*`/`_` emphasis runs before Markdown is re-injected into another editor or reader. Isolated literal asterisks must remain escaped.

**Why:** Turndown and equivalent serializers may emit escaped emphasis markers at the start of a paragraph or immediately after a line break; the next parser then displays the markers as literal text instead of restoring a strong node.

When page division cuts through emphasis, balance only delimiter spans that are
already matched in the complete paragraph. Track nested spans, treat combined
`***` runs as consumable bold/italic layers in either nesting order, and obey
flanking rules so literal symbols and unmatched openers are never mutated.

**Why:** A single active-delimiter flag corrupts nested emphasis, ordinary
multiplication/identifier punctuation, and unmatched user input while making
each split page look superficially valid.

**How to apply:** Share the boundary normalizer across web export, native
WebView export/import, and closing/read preview input. When splitting, derive
matched spans before slicing and close/reopen only spans crossing the cut. Keep
the generated native WebView bundle synchronized with its source.