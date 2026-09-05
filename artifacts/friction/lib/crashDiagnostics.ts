/**
 * crashDiagnostics
 *
 * Startup crash investigation tool (Task #1454).
 *
 * TestFlight builds have crashed ~0.2–0.3s after launch with a fatal JS error
 * reported via `RCTExceptionsManager reportFatal` → `RCTFatal` → abort. The
 * exported crash logs (both from the .ips files and from the App Store
 * Connect API's `betaFeedbackCrashSubmissions` crash logs) only contain the
 * native Objective-C++ unwind — they never include the JS exception message,
 * because by the time `RCTFatal` raises `NSException`, the original JS error
 * object/message has already been discarded by the bridge.
 *
 * This module installs a wrapper around React Native's `global.ErrorUtils`
 * handler — the same mechanism RN's default fatal-error reporting uses — so
 * that whenever a *fatal* JS error is about to crash the app, a safe error
 * class is persisted to disk SYNCHRONOUSLY (via `expo-file-system`'s JSI
 * `File.write`, not the async `expo-file-system/legacy` API) before control
 * is handed back to the default handler that calls `RCTFatal`/aborts the
 * process a moment later. Error messages and stacks are intentionally not
 * persisted because they can contain personal or authentication data.
 *
 * On the *next* app launch, `uploadPendingCrashLogIfAny()` reads that file
 * (if present), uploads it to the API server's `/client-logs` endpoint, and
 * deletes it so it is never re-uploaded. Check server logs
 * (`client-logs: fatal JS error reported by client`) after a crash + relaunch
 * cycle to see the fatal error class.
 *
 * `installGlobalErrorHandler()` MUST run as early as possible — before
 * `expo-router/entry` requires any app code — so it is imported as a side
 * effect from the app's `index.js` entry point, not from `app/_layout.tsx`
 * (which is itself app code that may throw during import).
 */
import { Platform } from "react-native";
import {
  getRenderDiagnostic,
  getRenderDiagnosticDedupeKey,
  getTemporaryComponentStackDiagnostic,
  shouldSendRenderDiagnostic,
  type ComponentStackDiagnostic,
  type RenderDiagnosticCode,
} from "./renderErrorDiagnostics";

const CRASH_LOG_FILENAME = "friction-last-fatal-crash.json";
export {
  getRenderDiagnostic,
  type RenderDiagnosticCode,
} from "./renderErrorDiagnostics";

/**
 * Best-effort reporting for errors caught by the root boundary. Raw messages,
 * JavaScript stacks, and user data never enter the payload. One explicitly
 * allowlisted iOS diagnostic build may attach a bounded React component stack.
 */
export function reportRenderError(
  error: unknown,
  component: ComponentStackDiagnostic,
  componentStack?: string,
): RenderDiagnosticCode {
  const diagnostic = getRenderDiagnostic(error);

  void (async () => {
    try {
      const Constants = (await import("expo-constants")).default;
      const { customFetch, getLastRequestId } = await import(
        "@workspace/api-client-react"
      );
      const { getReleaseDiagnosticContext } = await import("./authDiagnostics");
      const buildNumber =
        Platform.OS === "android"
          ? Constants.platform?.android?.versionCode != null
            ? String(Constants.platform.android.versionCode)
            : Constants.expoConfig?.android?.versionCode != null
              ? String(Constants.expoConfig.android.versionCode)
              : null
          : Constants.platform?.ios?.buildNumber ??
            Constants.expoConfig?.ios?.buildNumber ??
            null;
      const appVersion = Constants.expoConfig?.version ?? null;
      const requestId = getLastRequestId();
      const dedupeKey = getRenderDiagnosticDedupeKey(
         diagnostic.diagnosticCode,
         component.componentFingerprint,
        buildNumber,
      );
      if (!shouldSendRenderDiagnostic(dedupeKey)) return;
      const temporaryComponentStack = getTemporaryComponentStackDiagnostic(
        componentStack,
        diagnostic.diagnosticCode,
        Platform.OS,
        buildNumber,
      );

      await customFetch("/api/client-logs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          source: "render-error",
          message: "render-error",
          name: diagnostic.errorClass,
          isFatal: false,
          timestamp: new Date().toISOString(),
          platform: Platform.OS,
          platformVersion: String(Platform.Version),
          appVersion,
          buildNumber,
          requestId,
          diagnosticCode: diagnostic.diagnosticCode,
          componentFingerprint: component.componentFingerprint,
          componentDepth: component.componentDepth,
          ...(temporaryComponentStack
            ? { componentStack: temporaryComponentStack }
            : {}),
          release: getReleaseDiagnosticContext(),
        }),
      });
    } catch (reportError) {
      console.warn("[crashDiagnostics] Failed to report render error:", reportError);
    }
  })();

  return diagnostic.diagnosticCode;
}

export type PersistedCrashLog = {
  source: "fatal-js-error";
  message: string;
  name?: string;
  isFatal: boolean;
  timestamp: string;
  platform: string;
  platformVersion: string | number;
  requestId?: string | null;
  appVersion?: string | null;
  buildNumber?: string | null;
  release?: {
    track: "development" | "preview" | "production";
    configurationState: "valid" | "invalid" | "unavailable";
    configurationFingerprint: string | null;
    supabaseHost: string | null;
    apiHost: string | null;
  };
};

// Lazily resolved so importing this module never itself touches a native
// module before we know we need to (keeps this file safe to import first,
// unconditionally, from index.js).
function getCrashLogFile(): import("expo-file-system").File | null {
  try {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { File, Paths } = require("expo-file-system") as typeof import("expo-file-system");
    return new File(Paths.document, CRASH_LOG_FILENAME);
  } catch (err) {
    console.warn("[crashDiagnostics] expo-file-system unavailable:", err);
    return null;
  }
}

function classifyFatalError(error: unknown): { message: string; name: string } {
  const knownErrorNames = new Set([
    "Error",
    "TypeError",
    "ReferenceError",
    "SyntaxError",
    "RangeError",
    "URIError",
    "EvalError",
  ]);
  const name =
    error instanceof Error && knownErrorNames.has(error.name) ? error.name : "UnknownError";
  return { message: "fatal-js-error", name };
}

function persistFatalError(error: unknown, isFatal: boolean): void {
  try {
    const file = getCrashLogFile();
    if (!file) return;

    const payload: PersistedCrashLog = {
      source: "fatal-js-error",
      ...classifyFatalError(error),
      isFatal,
      timestamp: new Date().toISOString(),
      platform: Platform.OS,
      platformVersion: Platform.Version,
      requestId:
        typeof (globalThis as typeof globalThis & { __frictionLastRequestId?: unknown })
          .__frictionLastRequestId === "string"
          ? (globalThis as typeof globalThis & { __frictionLastRequestId?: string })
              .__frictionLastRequestId
          : null,
    };

    // Synchronous write (JSI-backed) — this is the whole point. By the time
    // the previous/default ErrorUtils handler returns, RCTFatal may already
    // be tearing the process down, so an async write would frequently lose
    // the race.
    file.write(JSON.stringify(payload));
  } catch (err) {
    // Never let diagnostics logging itself become the crash.
    console.warn("[crashDiagnostics] Failed to persist fatal error:", err);
  }
}

let installed = false;

/**
 * Wraps `global.ErrorUtils`'s handler so every fatal JS error is persisted to
 * disk before the default handler (which reports to native and aborts) runs.
 * Safe to call multiple times; only installs once.
 */
export function installGlobalErrorHandler(): void {
  if (installed) return;
  if (Platform.OS === "web") return;

  try {
    const errorUtils = (global as unknown as {
      ErrorUtils?: {
        setGlobalHandler: (fn: (error: unknown, isFatal?: boolean) => void) => void;
        getGlobalHandler?: () => ((error: unknown, isFatal?: boolean) => void) | undefined;
      };
    }).ErrorUtils;

    if (!errorUtils || typeof errorUtils.setGlobalHandler !== "function") {
      console.warn("[crashDiagnostics] global.ErrorUtils not available; skipping install.");
      return;
    }

    const previousHandler = errorUtils.getGlobalHandler?.();

    errorUtils.setGlobalHandler((error, isFatal) => {
      if (isFatal) {
        persistFatalError(error, true);
      }
      previousHandler?.(error, isFatal);
    });

    installed = true;
  } catch (err) {
    console.warn("[crashDiagnostics] Failed to install global error handler:", err);
  }
}

/**
 * Reads a crash log left behind by the previous launch (if any), uploads it
 * to the API server, then deletes it. Call once after the API client's base
 * URL has been configured. Best-effort: never throws.
 */
export async function uploadPendingCrashLogIfAny(): Promise<void> {
  if (Platform.OS === "web") return;

  try {
    const file = getCrashLogFile();
    if (!file || !file.exists) return;

    const contents = file.textSync();

    // Delete before uploading so a malformed payload or a permanently
    // unreachable server can never cause the same crash log to be retried
    // forever on every subsequent launch.
    try {
      file.delete();
    } catch (deleteErr) {
      console.warn("[crashDiagnostics] Failed to delete persisted crash log:", deleteErr);
    }

    const parsed = JSON.parse(contents) as Partial<PersistedCrashLog>;
    const Constants = (await import("expo-constants")).default;
    const { getReleaseDiagnosticContext } = await import("./authDiagnostics");
    // Older app versions may have persisted raw message/stack data. Never
    // forward that legacy payload into an operational log.
    const safePayload: PersistedCrashLog = {
      source: "fatal-js-error",
      message: "fatal-js-error",
      name: "FatalJavaScriptError",
      isFatal: true,
      timestamp: typeof parsed.timestamp === "string" ? parsed.timestamp : new Date().toISOString(),
      platform: typeof parsed.platform === "string" ? parsed.platform : Platform.OS,
      platformVersion:
        typeof parsed.platformVersion === "string" || typeof parsed.platformVersion === "number"
          ? parsed.platformVersion
          : Platform.Version,
      requestId:
        typeof parsed.requestId === "string" &&
        /^req_[a-z0-9]{20,32}$/.test(parsed.requestId)
          ? parsed.requestId
          : null,
      appVersion: Constants.expoConfig?.version ?? null,
      buildNumber:
        Platform.OS === "android"
          ? Constants.platform?.android?.versionCode != null
            ? String(Constants.platform.android.versionCode)
            : Constants.expoConfig?.android?.versionCode != null
              ? String(Constants.expoConfig.android.versionCode)
              : null
          : Constants.platform?.ios?.buildNumber ??
            Constants.expoConfig?.ios?.buildNumber ??
            null,
      release: getReleaseDiagnosticContext(),
    };

    const { customFetch } = await import("@workspace/api-client-react");
    await customFetch("/api/client-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(safePayload),
    });
  } catch (err) {
    console.warn("[crashDiagnostics] Failed to upload pending crash log:", err);
  }
}

// Install as a side effect of importing this module (see index.js).
installGlobalErrorHandler();
