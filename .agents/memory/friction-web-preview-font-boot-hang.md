---
name: Friction web preview stuck on boot spinner
description: Why appPreview screenshots of Friction (any route, even /login) can show only the "앱을 준비하고 있어요" spinner forever.
---

# Web preview boot spinner never clears

`app/_layout.tsx` gates the entire app behind `useFonts({...})` (Pretendard,
Eulyoo1945, and `NotoSerifKR_400Regular/600SemiBold/800ExtraBold` from
`@expo-google-fonts/noto-serif-kr`), rendering only a loading view until
`fontsLoaded || fontError || fontLoadTimedOut` (10s fallback timer).

On web, Metro can fail to resolve the NotoSerifKR asset paths for that
package (`Error: Asset not found: .../noto-serif-kr/NotoSerifKR_400Regular.ttf
for platform: web` — the real file lives one directory deeper, under
`400Regular/NotoSerifKR_400Regular.ttf`). This is a pre-existing, app-wide
issue unrelated to any single screen's code — every route (including
`/login`) is blocked by the same root layout gate.

**Why this matters for verification:** the `Screenshot` tool's `appPreview`
navigates fresh each call and captures almost immediately, well under the 10s
fallback. A `ShellExec sleep` between separate `Screenshot` calls does NOT
help — each call is an independent fresh page load, so the sleep elapses
outside the browser session and the timer restarts at 0 every time. Repeated
screenshots will show the spinner indefinitely.

**How to apply:** if `appPreview` shows only the spinner for a Friction
route, don't assume your own change broke it — check workflow logs for the
`Asset not found: ... noto-serif-kr ...` Metro error first. If present, this
is the pre-existing font-boot issue, not a regression. Fall back to
`tsc --noEmit` + a clean Metro "Web Bundled" log + careful manual code review
for verification instead of chasing a live screenshot.
