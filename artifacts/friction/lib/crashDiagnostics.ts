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
 * that whenever a *fatal* JS error is about to crash the app, its message and
 * stack are persisted to disk SYNCHRONOUSLY (via `expo-file-system`'s JSI
 * `File.write`, not the async `expo-file-system/legacy` API) before control
 * is handed back to the default handler that calls `RCTFatal`/aborts the
 * process a moment later.
 *
 * On the *next* app launch, `uploadPendingCrashLogIfAny()` reads that file
 * (if present), uploads it to the API server's `/client-logs` endpoint, and
 * deletes it so it is never re-uploaded. Check server logs
 * (`client-logs: fatal JS error reported by client`) after a crash + relaunch
 * cycle to see the real error.
 *
 * `installGlobalErrorHandler()` MUST run as early as possible — before
 * `expo-router/entry` requires any app code — so it is imported as a side
 * effect from the app's `index.js` entry point, not from `app/_layout.tsx`
 * (which is itself app code that may throw during import).
 */
import { Platform } from "react-native";

const CRASH_LOG_FILENAME = "friction-last-fatal-crash.json";

export type PersistedCrashLog = {
  source: "fatal-js-error";
  message: string;
  name?: string;
  stack?: string;
  isFatal: boolean;
  timestamp: string;
  platform: string;
  platformVersion: string | number;
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

function serializeError(error: unknown): { message: string; name?: string; stack?: string } {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack };
  }
  if (typeof error === "string") {
    return { message: error };
  }
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

function persistFatalError(error: unknown, isFatal: boolean): void {
  try {
    const file = getCrashLogFile();
    if (!file) return;

    const payload: PersistedCrashLog = {
      source: "fatal-js-error",
      ...serializeError(error),
      isFatal,
      timestamp: new Date().toISOString(),
      platform: Platform.OS,
      platformVersion: Platform.Version,
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

    const parsed = JSON.parse(contents) as PersistedCrashLog;

    const { customFetch } = await import("@workspace/api-client-react");
    await customFetch("/api/client-logs", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(parsed),
    });
  } catch (err) {
    console.warn("[crashDiagnostics] Failed to upload pending crash log:", err);
  }
}

// Install as a side effect of importing this module (see index.js).
installGlobalErrorHandler();
