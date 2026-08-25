import Constants from "expo-constants";
import { Platform } from "react-native";
import { customFetch } from "@workspace/api-client-react";
import { runtimeConfig } from "./runtimeConfig";
import type { SignupDiagnosticCode } from "./signupDiagnostics";

type AuthDiagnosticPhase =
  | "config"
  | "api-reachability"
  | "restore"
  | "auth-event"
  | "sign-in"
  | "sign-up"
  | "profile-sync";

export type AuthDiagnosticErrorClass =
  | "AuthSignUpError"
  | "AuthSignInError"
  | "AuthRestoreError"
  | "AuthTransitionError"
  | "NetworkError"
  | "TimeoutError"
  | "RequestError"
  | "RuntimeConfigError"
  | "SYNC_AUTH_INVALID"
  | "SYNC_AUTH_UNAVAILABLE"
  | "SYNC_DATABASE_UNAVAILABLE"
  | "SYNC_EMAIL_CONFLICT"
  | "SYNC_IDENTITY_MISMATCH"
  | "SYNC_INVALID_REQUEST"
  | "SYNC_UNKNOWN"
  | SignupDiagnosticCode;

export type ApiReachability = "checking" | "reachable" | "unreachable" | "not-applicable";

type ReleaseDiagnosticContext = {
  track: "development" | "preview" | "production";
  configurationState: "valid" | "invalid" | "unavailable";
  configurationFingerprint: string | null;
  supabaseHost: string | null;
  apiHost: string | null;
};

function hostnameOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null;
  }
}

function getReleaseDiagnosticContext(): ReleaseDiagnosticContext {
  const metadata = Constants.expoConfig?.extra?.releaseDiagnostics as
    | {
        track?: unknown;
        configurationFingerprint?: unknown;
        supabaseHost?: unknown;
        apiHost?: unknown;
      }
    | undefined;
  const track =
    metadata?.track === "preview" || metadata?.track === "production"
      ? metadata.track
      : "development";
  const supabaseHost = hostnameOf(runtimeConfig.supabaseUrl);
  const apiHost = hostnameOf(runtimeConfig.apiBaseUrl);
  const expectedSupabaseHost =
    typeof metadata?.supabaseHost === "string" ? metadata.supabaseHost.toLowerCase() : null;
  const expectedApiHost =
    typeof metadata?.apiHost === "string" ? metadata.apiHost.toLowerCase() : null;
  const configurationFingerprint =
    typeof metadata?.configurationFingerprint === "string" &&
    /^[a-f0-9]{16}$/.test(metadata.configurationFingerprint)
      ? metadata.configurationFingerprint
      : null;
  const hostsMatch =
    (!expectedSupabaseHost || expectedSupabaseHost === supabaseHost) &&
    (!expectedApiHost || expectedApiHost === apiHost);

  return {
    track,
    configurationState: runtimeConfig.errorMessage || !hostsMatch
      ? "invalid"
      : configurationFingerprint
        ? "valid"
        : "unavailable",
    configurationFingerprint,
    supabaseHost,
    apiHost,
  };
}

function safeNetworkErrorName(error: unknown): "NetworkError" | "TimeoutError" | "RequestError" {
  const name =
    typeof error === "object" && error !== null && typeof (error as { name?: unknown }).name === "string"
      ? (error as { name: string }).name.toLowerCase()
      : "";
  if (name.includes("abort") || name.includes("timeout")) return "TimeoutError";
  if (name.includes("network") || name.includes("fetch")) return "NetworkError";
  return "RequestError";
}

/**
 * Sends only a phase/outcome/error class. Never include email addresses,
 * access tokens, API response bodies, or exception messages here.
 */
export function reportAuthDiagnostic(
  phase: AuthDiagnosticPhase,
  outcome: string,
  errorName?: AuthDiagnosticErrorClass,
  flowId = createAuthFlowId(),
): void {
  if (Platform.OS === "web" || !runtimeConfig.apiBaseUrl) return;

  const appConfig = Constants.expoConfig;
  void customFetch("/api/client-logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "auth-flow",
      message: `phase=${phase};outcome=${outcome};flow=${flowId}`,
      name: errorName ?? null,
      isFatal: false,
      timestamp: new Date().toISOString(),
      platform: Platform.OS,
      platformVersion: String(Platform.Version),
      appVersion: appConfig?.version ?? null,
      buildNumber: appConfig?.ios?.buildNumber ?? null,
      release: getReleaseDiagnosticContext(),
    }),
  }).catch(() => undefined);
}

/**
 * A non-blocking native startup check. It deliberately probes the API separately
 * from Supabase so an eventual signup failure can say which service was unreachable.
 */
export async function probeApiReachability(): Promise<ApiReachability> {
  if (Platform.OS === "web") return "not-applicable";
  if (!runtimeConfig.apiBaseUrl) {
    reportAuthDiagnostic("api-reachability", "configuration-invalid", "RuntimeConfigError");
    return "unreachable";
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5_000);
  try {
    const response = await fetch(`${runtimeConfig.apiBaseUrl}/api/healthz`, {
      method: "GET",
      signal: controller.signal,
    });
    const outcome = response.ok
      ? "reachable"
      : response.status >= 500
        ? "server-error"
        : "unexpected-status";
    reportAuthDiagnostic("api-reachability", outcome);
    return response.ok ? "reachable" : "unreachable";
  } catch (error) {
    reportAuthDiagnostic("api-reachability", "unreachable", safeNetworkErrorName(error));
    return "unreachable";
  } finally {
    clearTimeout(timeout);
  }
}

export function createAuthFlowId(): string {
  return `af_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}
