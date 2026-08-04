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
 */
import type * as NotificationsType from "expo-notifications";

let notificationsModule: typeof NotificationsType | null = null;
let loadAttempted = false;

function loadNotificationsModule(): typeof NotificationsType | null {
  if (loadAttempted) return notificationsModule;
  loadAttempted = true;

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

  return notificationsModule;
}

/** Returns the `expo-notifications` module, or `null` if the native module isn't available. */
export function getNotificationsModule(): typeof NotificationsType | null {
  return loadNotificationsModule();
}

/** Whether the `expo-notifications` native module loaded successfully. */
export function isNotificationsAvailable(): boolean {
  return loadNotificationsModule() !== null;
}
