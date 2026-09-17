import PostHog from "posthog-react-native";
import Constants from "expo-constants";
import { Platform } from "react-native";
import { getLastRequestId } from "@workspace/api-client-react";
import {
  captureAndFlushDeliveryProbe,
  createPostHogDiagnostics,
  initializePostHogClient,
} from "./posthogDiagnostics";

export { PostHogProvider } from "posthog-react-native";

const token = process.env.EXPO_PUBLIC_POSTHOG_TOKEN ?? "";
const host = process.env.EXPO_PUBLIC_POSTHOG_HOST ?? "https://us.i.posthog.com";
const releaseDiagnostics = Constants.expoConfig?.extra?.releaseDiagnostics;
const diagnostics = createPostHogDiagnostics({
  host: releaseDiagnostics?.posthogHost ?? null,
  tokenFingerprint: releaseDiagnostics?.posthogTokenFingerprint ?? null,
});

// Guard: PostHog construction touches native modules. The factory classifies
// failure without allowing analytics to interrupt application startup.
export const posthog: PostHog | null = initializePostHogClient({
  token,
  create: (apiToken) =>
    new PostHog(apiToken, {
      host,
      captureAppLifecycleEvents: true,
    }),
  report: diagnostics.report,
});

if (posthog && Platform.OS !== "web") {
  void diagnostics.probeConnectivity(fetch);
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

export function runPostHogDeliveryProbe(): void {
  if (!posthog) return;
  try {
    void captureAndFlushDeliveryProbe({
        client: posthog,
        properties: {
          release_track: releaseDiagnostics?.track ?? "development",
          configuration_fingerprint: releaseDiagnostics?.configurationFingerprint ?? null,
        },
        flush: diagnostics.flush,
      })
      .catch(() => diagnostics.report("flush_failure"));
  } catch {
    diagnostics.report("flush_failure");
  }
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
