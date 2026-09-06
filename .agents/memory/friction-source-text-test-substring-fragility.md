---
name: Source-text test substring fragility
description: Why plain-word `not.toContain` assertions in source-text-based tests (bodyLayout.test.ts style) are unreliable, and what to assert instead.
---

Friction's large-screen tests (screens with no render harness) read the raw
`.tsx` source and assert on substrings. When writing a "no longer uses X"
assertion for a removed pattern, do not assert on a common English word alone
(`"visible"`, `"dim"`, `"BottomSheet"`, `"onClose"`) — it will very likely
still appear in a comment (e.g. "no dim overlay", "previously used
BottomSheet", "reacting to a `visible` prop") even after the real prop/import
is fully removed, causing a false-failing test.

**How to apply:** assert on the syntactic shape that would actually indicate
reintroduction instead of the bare word — `'<BottomSheet'`, `'from "@/.../BottomSheet"'`,
`"visible:"`/`"visible,"`/`"visible}"`, `"onClose("`, etc. If you must keep a
plain-word check, first grep the target file yourself to confirm the word
doesn't already appear in an unrelated comment before trusting the test.
