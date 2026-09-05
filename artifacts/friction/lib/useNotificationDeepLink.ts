/**
 * useNotificationDeepLink
 *
 * Listens for notification tap events (foreground/background) and cold-start
 * initial responses. When the tapped notification carries
 * `data.type === "LETTER_ARRIVED"`, navigates the user to the inbox tab
 * unless they are already there.
 *
 * Silently exits when:
 *   - userId is null/undefined (not authenticated)
 *   - Platform.OS === "web"
 *   - expo-notifications native module is unavailable
 */
import { useEffect, useRef } from "react";
import { Platform } from "react-native";
import { useRouter } from "expo-router";
import { getNotificationsModule } from "@/lib/safeNotifications";
import type * as NotificationsType from "expo-notifications";

export function useNotificationDeepLink(userId: string | null | undefined): void {
  const router = useRouter();
  const consumedInitialRef = useRef(false);

  useEffect(() => {
    if (!userId) return;
    if (Platform.OS === "web") return;

    const Notifications = getNotificationsModule();
    if (!Notifications) return;

    function handleResponse(response: NotificationsType.NotificationResponse): void {
      const data = response.notification.request.content.data as
        | Record<string, unknown>
        | null
        | undefined;

      if (data?.type !== "LETTER_ARRIVED") return;

      // Use the explicit tab route. The normal initial tab is the record
      // screen, so relying on the tab navigator's initial route would send a
      // notification tap to the wrong place.
      router.replace("/(tabs)/index");
    }

    // Cold-start: check for the response that launched the app
    if (!consumedInitialRef.current) {
      consumedInitialRef.current = true;
      Notifications.getLastNotificationResponseAsync()
        .then((initial) => {
          if (initial) {
            handleResponse(initial);
          }
        })
        .catch(() => {
          // Silently ignore — native module issues
        });
    }

    // Foreground / background tap listener
    const subscription = Notifications.addNotificationResponseReceivedListener(handleResponse);

    return () => {
      subscription.remove();
    };
  }, [userId, router]);
}
