/**
 * usePushNotifications
 *
 * Requests notification permission, fetches an Expo push token,
 * and registers it with the API server.
 *
 * Silently exits when:
 *   - permission is denied
 *   - the device has no projectId configured
 *   - the server request fails
 *   - the expo-notifications native module is unavailable (e.g. a stale
 *     dev-client/TestFlight binary built before this module was added)
 *
 * Call this hook once after the user is authenticated (e.g. in the root layout
 * inside AuthGuard when session exists).
 */
import { useEffect } from "react";
import { Platform } from "react-native";
import { getNotificationsModule } from "@/lib/safeNotifications";
import Constants from "expo-constants";
import { customFetch } from "@workspace/api-client-react";

const EXPO_PROJECT_ID: string | undefined =
  Constants.expoConfig?.extra?.eas?.projectId ??
  (Constants.easConfig as { projectId?: string } | undefined)?.projectId;

export function usePushNotifications(userId: string | null | undefined): void {
  useEffect(() => {
    if (!userId) return;
    if (Platform.OS === "web") return;

    let cancelled = false;

    async function registerToken(): Promise<void> {
      try {
        const Notifications = getNotificationsModule();
        if (!Notifications) {
          // Native module unavailable (e.g. stale dev-client/TestFlight
          // binary built before expo-notifications was added) — exit
          // silently, same as permission-denied / no-project-id.
          return;
        }

        // Request permission
        const { status: existingStatus } = await Notifications.getPermissionsAsync();
        let finalStatus = existingStatus;

        if (existingStatus !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }

        if (finalStatus !== "granted") {
          // User denied — exit silently
          return;
        }

        if (!EXPO_PROJECT_ID) {
          console.warn("[usePushNotifications] No Expo project ID configured; skipping token registration.");
          return;
        }

        const tokenData = await Notifications.getExpoPushTokenAsync({
          projectId: EXPO_PROJECT_ID,
        });

        if (cancelled) return;

        await customFetch("/api/push-tokens", {
          method: "POST",
          body: JSON.stringify({
            token: tokenData.data,
            platform: Platform.OS as "ios" | "android",
          }),
          headers: { "Content-Type": "application/json" },
        });
      } catch (err) {
        // Never surface push-registration errors to the user
        console.warn("[usePushNotifications] Registration failed:", err);
      }
    }

    registerToken();

    return () => {
      cancelled = true;
    };
  }, [userId]);
}
