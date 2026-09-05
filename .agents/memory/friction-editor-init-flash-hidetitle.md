---
name: WebViewMarkdownEditor hideTitle flash and remount contract
description: Why the native markdown editor's title-input flashed on mount, how it was fixed, and why hideTitle never needs to change on a live instance.
---

The native (iOS/Android) `WebViewMarkdownEditor` renders `#title-input` in its
static HTML unconditionally. Toggling it via a postMessage round-trip after
first paint (waiting for fonts to load, then an "init" reply) causes a
visible flash on any screen with `hideTitle` true. The fix instead freezes
`hideTitle`'s value at mount into a ref and bakes it directly into the
generated WebView HTML/CSS, so the very first paint already reflects the
final state — no round trip needed. `editorHtml.ts` is generated output from
a build script; never hand-edit it, regenerate (and run its `--check` mode)
after touching the generator or its bundled WebView source.

**Why freezing at mount is safe:** every call site that changes whether a
title should show does it by fully unmounting and remounting the screen
(e.g. via a route replace with different params, which React Navigation
treats as a brand-new route entry) rather than flipping `hideTitle` on a
*live* editor instance. Other callers that pass `hideTitle` always pass a
literal boolean, never a variable, so they are unaffected.

**How to apply:** if a future need arises for `hideTitle` to change without
a screen remount, a genuine runtime "show title" command must be added — the
existing init-time hiding logic only ever hides, never un-hides, so don't
assume it generalizes to that case.
