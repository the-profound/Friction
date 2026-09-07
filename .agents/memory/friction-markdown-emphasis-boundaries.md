---
name: Friction Markdown emphasis boundaries
description: Emphasis delimiters can be escaped at paragraph boundaries and must be normalized before the next editor or reader parser.
---

WYSIWYG editor exports must normalize only flanking escapes around `*`/`_` emphasis runs before Markdown is re-injected into another editor or reader. Isolated literal asterisks must remain escaped.

**Why:** Turndown and equivalent serializers may emit escaped emphasis markers at the start of a paragraph or immediately after a line break; the next parser then displays the markers as literal text instead of restoring a strong node.

**How to apply:** Share the boundary normalizer across web export, native WebView export/import, and closing/read preview input. Keep the generated native WebView bundle synchronized with its source.