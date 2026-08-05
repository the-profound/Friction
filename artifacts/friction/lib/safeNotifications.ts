/**
 * safeNotifications
 *
 * `expo-notifications` calls `requireNativeModule("ExpoPushTokenManager")`
 * as a side effect of being imported — outside of any try/catch a caller
 * could wrap around a normal `import`. If the installed native binary was
 * built before this module was added (e.g. a stale TestFlight/dev-client
 * build), that throws synchronously and crashes the entire JS module graph
 * before the app can render anything.
 *
 * This module isolates that risky `require` behind a try/catch so the rest
 * of the app can boot normally even when the native module is missing.
 * Consumers should always go through `getNotificationsModule()` /
 * `isNotificationsAvailable()` instead of `import * as Notifications from
 * "expo-notifications"` directly.
 *
 * IMPORTANT: the `require("expo-notifications")` call below must run
 * eagerly, as a side effect of this module being loaded (this file is
 * statically imported from `app/_layout.tsx`, so it executes as part of the
 * app's initial synchronous bundle evaluation). Metro's module loader
 * (`guardedLoadModule`) only lets errors thrown during a `require()`
 * propagate as normal, catchable JS exceptions when that `require()` is
 * nested inside an already-in-progress top-level require. If this call were
 * deferred to the first invocation from inside a `useEffect` (i.e. after
 * the entry bundle already finished loading), Metro would treat it as a new
 * top-level entry point and forward any thrown error straight to the
 * global fatal-error handler — producing an uncatchable red-screen crash
 * even though this try/catch exists.
 */
import type * as NotificationsType from "expo-notifications";

let notificationsModule: typeof NotificationsType | null = null;

try {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  notificationsModule = require("expo-notifications") as typeof NotificationsType;
} catch (err) {
  console.warn(
    "[safeNotifications] expo-notifications native module is unavailable; push notifications will be disabled for this session.",
    err,
  );
  notificationsModule = null;
}

/** Returns the `expo-notifications` module, or `null` if the native module isn't available. */
export function getNotificationsModule(): typeof NotificationsType | null {
  return notificationsModule;
}

/** Whether the `expo-notifications` native module loaded successfully. */
export function isNotificationsAvailable(): boolean {
  return notificationsModule !== null;
}
