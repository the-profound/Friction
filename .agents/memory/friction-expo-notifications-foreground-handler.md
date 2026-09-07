---
name: Expo notifications foreground display default
description: expo-notifications silently suppresses banner/sound while the app is foregrounded unless a handler opts in; a plugin option that looks related may not exist in the installed version.
---

Without an app-level `Notifications.setNotificationHandler(...)`, expo-notifications
does not show a banner or play a sound for a push received while the app is in the
foreground — it silently swallows it. This applies even when the server-sent
message itself has a normal sound/priority. Fix: register a handler (e.g. in the
module that first `require("expo-notifications")`s, so it's set before any
notification can arrive) returning `{ shouldShowBanner: true, shouldShowList: true,
shouldPlaySound: true, shouldSetBadge: true }`.

**Why:** a task converting a push from "silent" to "normal" (banner+sound) fixed the
server payload and the Android channel but was rejected by code review because
foreground iOS presentation was still suppressed by this default.

Separately: `app.config.js` had `["expo-notifications", { iosDisplayInForeground: false
}]`, which looked like the cause but was actually a dead option — the installed
expo-notifications plugin version (57.0.8) doesn't define or consume
`iosDisplayInForeground` in `NotificationsPluginProps`, so it silently did nothing.
Don't assume a plausible-looking config plugin prop is real; check
`node_modules/.pnpm/expo-notifications@<version>/node_modules/expo-notifications/plugin/src/withNotifications.ts`
for the actual accepted prop list before trusting it, or removing/changing it.

**How to apply:** any time notification presentation behavior (banner/sound/badge)
changes, check both (1) the server-sent message config, (2) the platform channel
(Android) or entitlements (iOS) config, and (3) whether a JS-side
`setNotificationHandler` exists and is not overriding intended behavior — all three
layers must agree.
