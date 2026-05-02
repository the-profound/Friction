import PostHog from "posthog-react-native";

export { PostHogProvider } from "posthog-react-native";

const token = process.env.EXPO_PUBLIC_POSTHOG_TOKEN ?? "";
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";

export let posthog: PostHog | null = null;

if (token) {
  posthog = new PostHog(token, {
    host,
    captureNativeAppLifecycleEvents: true,
  });
} else if (__DEV__) {
  console.warn("[PostHog] EXPO_PUBLIC_POSTHOG_TOKEN is not set. Analytics disabled.");
}

export function captureException(error: unknown): void {
  if (!posthog) return;
  const err = error instanceof Error ? error : new Error(String(error));
  posthog.captureException(err);
}
