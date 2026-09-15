import PostHog from "posthog-react-native";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getLastRequestId } from "@workspace/api-client-react";

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

function runPostHogOperation(operation: (client: PostHog) => unknown): void {
  if (!posthog) return;
  try {
    const result = operation(posthog);
    if (
      result &&
      typeof result === "object" &&
      "catch" in result &&
      typeof result.catch === "function"
    ) {
      void result.catch(() => undefined);
    }
  } catch {
    // Analytics must never block or break authentication and navigation.
  }
}

export function identifyPostHogUser(userId: string): void {
  runPostHogOperation((client) => client.identify(userId));
}

export function resetPostHogUser(): void {
  runPostHogOperation((client) => client.reset());
}

export interface PostHogIdentitySnapshot {
  distinctId: string;
  anonymousId: string;
}

export function getPostHogIdentitySnapshot(): PostHogIdentitySnapshot | null {
  if (!posthog) return null;
  try {
    const distinctId = posthog.getDistinctId();
    const anonymousId = posthog.getAnonymousId();
    // Before the React Native client has hydrated persisted storage, both
    // accessors return empty strings. Treat that as unavailable so callers
    // isolate accounts instead of identifying over an unknown persisted user.
    if (!distinctId || !anonymousId) return null;
    return { distinctId, anonymousId };
  } catch {
    return null;
  }
}

export function captureException(error: unknown): void {
  if (!posthog) return;
  const errorClass =
    error instanceof Error && /^[A-Za-z]+Error$/.test(error.name)
      ? error.name
      : "UnknownError";
  posthog.capture("client_exception", {
    error_class: errorClass,
    platform: Platform.OS,
    app_version: Constants.expoConfig?.version ?? null,
    build_number:
      Platform.OS === "android"
        ? Constants.expoConfig?.android?.versionCode != null
          ? String(Constants.expoConfig.android.versionCode)
          : null
        : Constants.expoConfig?.ios?.buildNumber ?? null,
    release_track:
      Constants.expoConfig?.extra?.releaseDiagnostics?.track ?? "development",
    request_id: getLastRequestId(),
  });
}
