---
name: Cross-WebView font fallback
description: How independent native WebView font timeouts must converge on one body typography mode.
---

Native editor, reader, and measurement WebViews decode the same embedded fonts
independently. If any one reaches its timeout or fails, fallback must become a
session-sticky shared decision and be pushed to every active body WebView.
Measurement request identity must include that mode, including imperative
auto-division requests, so a result from the previous font mode cannot resolve
after the mode changes.

**Why:** Independent WebView timers can straddle the timeout: one document may
finish with the custom face while another freezes a system fallback. Equal
numeric font size and width do not make those two layouts equivalent.

**How to apply:** Any new body renderer or measurement engine must report its
final font readiness to the shared native mode, subscribe to fallback changes,
and invalidate or replace in-flight work when the mode changes. Fallback is
one-way for the app session; do not silently upgrade only one document later.