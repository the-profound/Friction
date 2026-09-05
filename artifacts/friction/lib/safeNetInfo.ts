/**
 * Safely isolates NetInfo's native-module lookup from the app entry module.
 *
 * Older development clients may not contain RNCNetInfo. A normal static import
 * would then throw while Expo Router is evaluating the root layout and prevent
 * the app from rendering at all. Keep this require eager and inside a catchable
 * boundary, matching the startup-safe pattern used by safeNotifications.
 */
import type NetInfoType from "@react-native-community/netinfo";

type NetInfoModule = typeof NetInfoType;
type SetOnline = (online: boolean) => void;
type Unsubscribe = () => void;

let netInfoModule: NetInfoModule | null = null;

try {
  // This must remain an eager require; see safeNotifications for the Metro
  // guardedLoadModule behavior that makes startup errors catchable here.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  netInfoModule = require("@react-native-community/netinfo").default as NetInfoModule;
} catch (err) {
  console.warn(
    "[safeNetInfo] RNCNetInfo is unavailable; offline detection will be disabled for this session.",
    err,
  );
  netInfoModule = null;
}

/** Returns NetInfo, or null when the installed native binary does not provide it. */
export function getNetInfoModule(): NetInfoModule | null {
  return netInfoModule;
}

/**
 * Connects NetInfo to a consumer while preserving the online-by-default
 * fallback if either native loading or listener registration is unavailable.
 */
export function subscribeToNetInfo(
  setOnline: SetOnline,
  module: NetInfoModule | null = netInfoModule,
): Unsubscribe {
  if (!module) {
    setOnline(true);
    return () => {};
  }

  try {
    return module.addEventListener((state) => {
      setOnline(!!state.isConnected);
    });
  } catch (err) {
    console.warn(
      "[safeNetInfo] Failed to subscribe to connectivity changes; assuming online for this session.",
      err,
    );
    setOnline(true);
    return () => {};
  }
}