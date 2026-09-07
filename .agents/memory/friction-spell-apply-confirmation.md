---
name: Friction spell-check apply confirmation
description: Fuzzy-match WebView commands must confirm success back to RN, not fire-and-forget — and remember to rebuild editorHtml.ts.
---

A WebView command whose effect depends on a fuzzy/best-effort text search
(e.g. locating a spell-check suggestion in the live document) must not be
fire-and-forget. A failed search can silently no-op while RN still assumes
success and advances its own state. Route such commands through the existing
generic WebView<->RN request/response bridge (`lib/webViewBridge.ts`'s
`bridge.request()` / the shim's `respond()`) instead of a plain one-way
command, and gate any RN-side bookkeeping on the resolved result.

**Why:** the spell-check "적용" flow counted a fix as applied the instant the
command was sent, so a match failure (context landing on a Markdown
formatting boundary that the search couldn't see) looked identical to a real
edit — nothing told the user or the state machine anything went wrong.

**How to apply:** don't invent a new ad hoc resolver mechanism per command;
reuse the existing request/response bridge. See
`friction-dev-workflow.md`'s "WebView 에디터 소스 수정 후 반드시 번들 재빌드" —
any change to `editorWebviewSrc/index.ts` (including this kind of fix) still
needs `pnpm run build:editor` before it takes effect at runtime; a completion
review caught this exact bundle-not-rebuilt gap once already.
