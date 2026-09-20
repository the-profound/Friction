---
name: Friction web preview font startup
description: Why web preview must not block the whole app while Expo fonts load.
---

# Web preview must not wait for fonts

The web preview must render immediately with system font fallbacks while
`useFonts({...})` continues in the background. The native app may still gate
startup on its bundled font contract, font error, or timeout.

On web, Metro can fail to resolve the NotoSerifKR asset paths for that
package (`Error: Asset not found: .../noto-serif-kr/NotoSerifKR_400Regular.ttf
for platform: web` — the real file lives one directory deeper, under
`400Regular/NotoSerifKR_400Regular.ttf`). A slow or failed web font request
must not make that app-wide asset issue block every route.

**Why:** `appPreview` opens a fresh page and captures quickly. When web shared
the native font gate, every screenshot showed only "앱을 준비하고 있어요"
even though Metro and the API were healthy.

**How to apply:** keep the web platform outside the font-blocking startup
condition. Continue calling the font hook so custom fonts apply when ready,
but allow web routes and screenshots to render with fallbacks immediately.
