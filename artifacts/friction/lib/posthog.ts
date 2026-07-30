import PostHog from "posthog-react-native";

export { PostHogProvider } from "posthog-react-native";

const token = process.env.EXPO_PUBLIC_POSTHOG_TOKEN ?? "";
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export let posthog: PostHog | null = null;

if (token) {
  // Guard: PostHog constructor touches native modules (lifecycle observers, device info)
  // via TurboModule. If that call throws (e.g. on iOS 26 with enhanced PAC memory
  // protection), we catch it here so the rest of app startup is unaffected.
  try {
    posthog = new PostHog(token, {
      host,
      captureAppLifecycleEvents: true,
    });
  } catch (err) {
    console.warn("[PostHog] Initialization failed — analytics disabled for this session:", err);
    posthog = null;
  }
} else if (__DEV__) {
  console.warn("[PostHog] EXPO_PUBLIC_POSTHOG_TOKEN is not set. Analytics disabled.");
}

export function captureException(error: unknown): void {
  if (!posthog) return;
  const err = error instanceof Error ? error : new Error(String(error));
  posthog.captureException(err);
}
