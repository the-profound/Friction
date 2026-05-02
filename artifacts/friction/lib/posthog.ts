import PostHog from "posthog-react-native";

export let posthog: PostHog | null = null;

export function initPostHog(): PostHog | null {
  const token = process.env.EXPO_PUBLIC_POSTHOG_TOKEN;
  const host = process.env.EXPO_PUBLIC_POSTHOG_HOST;

  if (!token || !host) {
    if (__DEV__) {
      console.warn("[PostHog] EXPO_PUBLIC_POSTHOG_TOKEN or EXPO_PUBLIC_POSTHOG_HOST is not set.");
    }
    return null;
  }

  posthog = new PostHog(token, {
    host,
    captureNativeAppLifecycleEvents: true,
    autocapture: true,
  });

  return posthog;
}

export function captureException(error: unknown): void {
  if (!posthog) return;
  const err = error instanceof Error ? error : new Error(String(error));
  posthog.captureException(err);
}
