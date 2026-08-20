import Constants from "expo-constants";
import { Platform } from "react-native";
import { customFetch } from "@workspace/api-client-react";
import { runtimeConfig } from "./runtimeConfig";

type AuthDiagnosticPhase =
  | "config"
  | "restore"
  | "auth-event"
  | "sign-in"
  | "sign-up"
  | "profile-sync";

/**
 * Sends only a phase/outcome/error class. Never include email addresses,
 * access tokens, API response bodies, or exception messages here.
 */
export function reportAuthDiagnostic(
  phase: AuthDiagnosticPhase,
  outcome: string,
  errorName?: string,
): void {
  if (Platform.OS === "web" || !runtimeConfig.apiBaseUrl) return;

  const appConfig = Constants.expoConfig;
  void customFetch("/api/client-logs", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: "auth-flow",
      message: `phase=${phase};outcome=${outcome}`,
      name: errorName ?? null,
      isFatal: false,
      timestamp: new Date().toISOString(),
      platform: Platform.OS,
      platformVersion: String(Platform.Version),
      appVersion: appConfig?.version ?? null,
      buildNumber: appConfig?.ios?.buildNumber ?? null,
    }),
  }).catch(() => undefined);
}