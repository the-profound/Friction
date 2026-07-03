---
name: Friction reading-memo WebView editor
description: Why the reading-mode memo editor uses the WebView TipTap engine and how its button-driven page-flip works
---

# Reading-mode memo editor uses the WebView (TipTap) engine

The reading screen's memo notepad (cream "capsule" over the reader card) uses the
SAME WebView TipTap editor as the 기록 tab — NOT a native RN TextInput.

**Why:** the reader font (Eulyoo1945) has no italic face and bold only via a
separate SemiBold family, so React Native cannot synthesize italic/bold. Only a
browser (WebView) can synthesize them, so B/I/U/quote toolbar formatting requires
the WebView editor. A native editor cannot make the toolbar work.

**How to apply:**
- The shared `WebViewMarkdownEditor` has an additive `hideTitle` prop that hides
  the title/source-article chrome so it can be reused as a bare body editor.
  Do NOT restyle the 기록 tab screen when touching this.
- `MemoWebEditor` wraps it with the cream capsule + page hint row. The card bg is
  cream; the WebView body is transparent so cream shows through.
- Editor imperative API: `toggleMark("bold"|"italic"|"underline")`,
  `setBlockType("blockquote"|"paragraph")`, `setMarkdown`, `requestExportMarkdown(reqId)`;
  events `onExportMarkdown{markdown,requestId}`, `onSelectionUpdate{activeBlock,isBold,isItalic,isUnderline}`.
- Page-turn is BUTTON-driven (toolbar prev/next), not gesture-driven: the WebView
  captures touches so the old pan-tracked flip is impossible. The reader's pan
  gesture memo-mode branches are neutralized (early return).
- Flip flow: press → `requestExport("turn:N")` saves the current page's markdown via
  the export event → then a two-phase rotateX flip (rotate out to ±90°, swap content
  with `setMarkdown`, rotate in from ∓90°). A ~220ms fallback timer runs the flip if
  the export event never arrives (editor not ready). Exit also exports("exit")+blur
  to capture last edits before slide-out.

# Empty blockquote round-trip leaves permanent gray bars

Toggling quote on an empty line makes an empty `<blockquote>`; naive markdown
export emits a bare `>` line, which every re-import turns back into an empty
blockquote — the gray left-border bar then persists forever on the memo page
(and in the static block renderer used for flips).

**Rule:** treat contentless blockquotes as empty paragraphs at EVERY boundary:
markdown export (skip emitting `>`), both markdown→HTML renderers, and
`parseMarkdownBlocks` (legacy data may already contain bare `>` lines, so the
parse-side healing is required, not optional).

**How to apply:** after editing `editorWebviewSrc/index.ts`, ALWAYS rebuild the
bundled HTML (`pnpm build:editor` in artifacts/friction) or the change won't
reach the app — `editorHtml.ts` is generated, not imported live.
