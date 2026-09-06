---
name: Editor blank paragraph ownership
description: Distinguishes editor-authored blank lines from synthetic caret targets at document boundaries.
---

Never remove trailing empty editor paragraphs based only on their position or empty text. A trailing blank paragraph may represent user-authored terminal newlines; only an explicitly marked, structurally empty caret-only paragraph is synthetic.

**Why:** Web and native HTML-to-Markdown exporters previously removed every terminal empty paragraph, which preserved internal blank lines but silently erased authored consecutive newlines at the end after saving.

**How to apply:** Any editor parser, serializer, or TipTap schema change must preserve the synthetic-caret marker through HTML round trips, remove only that marked empty node, and serialize every other empty paragraph. Do not classify whitespace-authored nodes with `trim()`.