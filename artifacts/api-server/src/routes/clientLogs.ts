import { Router, type IRouter } from "express";
import { ReportClientLogBody, type ClientLogBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

const AUTH_FLOW_MESSAGE =
  /^phase=([a-z-]+);outcome=([A-Za-z0-9_-]+);flow=(af_[a-z0-9]{12,24})$/;
const AUTH_FLOW_OUTCOMES = {
  config: new Set(["invalid-build"]),
  "api-reachability": new Set([
    "configuration-invalid",
    "reachable",
    "server-error",
    "unexpected-status",
    "unreachable",
  ]),
  restore: new Set([
    "authenticated",
    "retryable-failure",
    "logged-out",
    "stale-result-ignored",
    "failed-logged-out",
    "stale-failure-ignored",
  ]),
  "auth-event": new Set([
    "INITIAL_SESSION",
    "SIGNED_IN",
    "SIGNED_OUT",
    "TOKEN_REFRESHED",
    "USER_UPDATED",
    "PASSWORD_RECOVERY",
    "MFA_CHALLENGE_VERIFIED",
  ]),
  "sign-in": new Set(["failed", "auth-succeeded", "success"]),
  "sign-up": new Set([
    "failed",
    "auth-succeeded-confirmation-required",
    "auth-succeeded-auto-confirmed",
    "success-auto-confirmed",
    "confirmation-required",
  ]),
  "profile-sync": new Set(["started", "succeeded", "failed", "failed-background"]),
} as const;
const AUTH_ERROR_CLASSES = new Set([
  "AuthSignUpError",
  "AuthSignInError",
  "AuthRestoreError",
  "AuthTransitionError",
  "NetworkError",
  "TimeoutError",
  "RequestError",
  "RuntimeConfigError",
  "SYNC_AUTH_INVALID",
  "SYNC_AUTH_UNAVAILABLE",
  "SYNC_DATABASE_UNAVAILABLE",
  "SYNC_EMAIL_CONFLICT",
  "SYNC_IDENTITY_MISMATCH",
  "SYNC_INVALID_REQUEST",
  "SYNC_UNKNOWN",
  "SIGNUP_AUTH_SERVICE",
  "SIGNUP_NETWORK",
  "SIGNUP_API_UNREACHABLE",
  "AUTH_TRANSITION_ERROR",
  "SIGNUP_UNKNOWN",
]);
const SAFE_HOSTNAME =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/i;
const RENDER_ERROR_CLASSES = new Set([
  "Error",
  "TypeError",
  "ReferenceError",
  "SyntaxError",
  "RangeError",
  "URIError",
  "EvalError",
  "UnknownError",
]);
const RENDER_DIAGNOSTIC_CODE_BY_CLASS = new Map([
  ["Error", "RND-ERROR"],
  ["TypeError", "RND-TYPE"],
  ["ReferenceError", "RND-REFERENCE"],
  ["SyntaxError", "RND-SYNTAX"],
  ["RangeError", "RND-RANGE"],
  ["URIError", "RND-URI"],
  ["EvalError", "RND-EVAL"],
  ["UnknownError", "RND-UNKNOWN"],
]);
function recordFatalCrashSignal(
  diagnostic: ReturnType<typeof safeDiagnosticLog>,
): void {
  logger.error(
    {
      event: "operational.metric",
      operation: "mobile.fatal-crash",
      outcome: "failure",
      count: 1,
      platform: diagnostic.platform,
      appVersion: diagnostic.appVersion,
      buildNumber: diagnostic.buildNumber,
      releaseTrack: diagnostic.release?.track,
      correlationId: diagnostic.requestId,
    },
    "operational metric: mobile fatal crash",
  );
}

function getSafeReleaseDiagnostic(input: unknown): {
  track: "development" | "preview" | "production";
  configurationState: "valid" | "invalid" | "unavailable";
  configurationFingerprint: string | null;
  supabaseHost: string | null;
  apiHost: string | null;
} | null {
  if (typeof input !== "object" || input === null) return null;
  const release = input as Record<string, unknown>;
  if (
    release.track !== "development" &&
    release.track !== "preview" &&
    release.track !== "production"
  ) {
    return null;
  }
  if (
    release.configurationState !== "valid" &&
    release.configurationState !== "invalid" &&
    release.configurationState !== "unavailable"
  ) {
    return null;
  }

  return {
    track: release.track,
    configurationState: release.configurationState,
    configurationFingerprint:
      typeof release.configurationFingerprint === "string" &&
      /^[a-f0-9]{16}$/.test(release.configurationFingerprint)
        ? release.configurationFingerprint
        : null,
    supabaseHost:
      typeof release.supabaseHost === "string" &&
      SAFE_HOSTNAME.test(release.supabaseHost)
        ? release.supabaseHost.toLowerCase()
        : null,
    apiHost:
      typeof release.apiHost === "string" && SAFE_HOSTNAME.test(release.apiHost)
        ? release.apiHost.toLowerCase()
        : null,
  };
}

/**
 * The diagnostics endpoint is intentionally unauthenticated. Treat every
 * field as hostile and retain only a compact, allowlisted operational event.
 */
export function getSafeAuthFlowDiagnostic(input: {
  message?: unknown;
  name?: unknown;
  platform?: unknown;
  release?: unknown;
  appVersion?: unknown;
  buildNumber?: unknown;
}): {
  phase: string;
  outcome: string;
  flowId: string;
  errorClass: string | null;
  platform: "ios" | "android" | null;
  release: ReturnType<typeof getSafeReleaseDiagnostic>;
} | null {
  const match =
    typeof input.message === "string" ? AUTH_FLOW_MESSAGE.exec(input.message) : null;
  if (!match) return null;

  const [, phase, outcome, flowId] = match;
  const allowedOutcomes =
    AUTH_FLOW_OUTCOMES[phase as keyof typeof AUTH_FLOW_OUTCOMES];
  if (!allowedOutcomes?.has(outcome as never)) return null;

  return {
    phase,
    outcome,
    flowId,
    errorClass:
      typeof input.name === "string" && AUTH_ERROR_CLASSES.has(input.name)
        ? input.name
        : null,
    platform: input.platform === "ios" || input.platform === "android"
      ? input.platform
      : null,
    release: getSafeReleaseDiagnostic(input.release),
  };
}

export function getSafeRenderErrorDiagnostic(input: {
  message?: unknown;
  name?: unknown;
  stack?: unknown;
  diagnosticCode?: unknown;
  platform?: unknown;
  appVersion?: unknown;
  buildNumber?: unknown;
  requestId?: unknown;
  release?: unknown;
}) {
  if (
    input.message !== "render-error" ||
    input.stack != null ||
    typeof input.name !== "string" ||
    !RENDER_ERROR_CLASSES.has(input.name) ||
    typeof input.diagnosticCode !== "string" ||
    RENDER_DIAGNOSTIC_CODE_BY_CLASS.get(input.name) !== input.diagnosticCode
  ) {
    return null;
  }

  return {
    errorClass: input.name,
    diagnosticCode: input.diagnosticCode,
    platform:
      input.platform === "ios" || input.platform === "android"
        ? input.platform
        : null,
    appVersion:
      typeof input.appVersion === "string" &&
      /^[0-9A-Za-z._-]+$/.test(input.appVersion)
        ? input.appVersion
        : null,
    buildNumber:
      typeof input.buildNumber === "string" &&
      /^[0-9]+$/.test(input.buildNumber)
        ? input.buildNumber
        : null,
    requestId:
      typeof input.requestId === "string" &&
      /^req_[a-z0-9]{20,32}$/.test(input.requestId)
        ? input.requestId
        : null,
    release: getSafeReleaseDiagnostic(input.release),
  };
}

function safeDiagnosticLog(data: ClientLogBody) {
  const source =
    data.source === "fatal-js-error" ? "fatal-js-error" : data.source === "auth-flow" ? "auth-flow" : "unknown";
  const safeAuthMessage =
    typeof data.message === "string" &&
    /^phase=[a-z-]+;outcome=[a-z-]+$/.test(data.message)
      ? data.message
      : "redacted";
  const safeName =
    typeof data.name === "string" && /^[A-Za-z]+(?:Error)?$/.test(data.name)
      ? data.name
      : null;
  const safeTimestamp =
    typeof data.timestamp === "string" && /^\d{4}-\d{2}-\d{2}T/.test(data.timestamp)
      ? data.timestamp
      : null;
  const safePlatform = data.platform === "ios" || data.platform === "android" ? data.platform : null;
  const safePlatformVersion =
    typeof data.platformVersion === "string" && /^[0-9.]+$/.test(data.platformVersion)
      ? data.platformVersion
      : null;
  const safeAppVersion =
    typeof data.appVersion === "string" && /^[0-9A-Za-z._-]+$/.test(data.appVersion)
      ? data.appVersion
      : null;
  const safeBuildNumber =
    typeof data.buildNumber === "string" && /^[0-9]+$/.test(data.buildNumber)
      ? data.buildNumber
      : null;
  const safeRequestId =
    typeof data.requestId === "string" &&
    /^req_[a-z0-9]{20,32}$/.test(data.requestId)
      ? data.requestId
      : null;
  const release =
    data.release &&
    (data.release.track === "development" ||
      data.release.track === "preview" ||
      data.release.track === "production")
      ? {
          track: data.release.track,
          configurationState: data.release.configurationState,
          configurationFingerprint: data.release.configurationFingerprint ?? null,
          supabaseHost:
            data.release.supabaseHost &&
            /^[a-z0-9.-]+$/i.test(data.release.supabaseHost)
              ? data.release.supabaseHost
              : null,
          apiHost:
            data.release.apiHost && /^[a-z0-9.-]+$/i.test(data.release.apiHost)
              ? data.release.apiHost
              : null,
        }
      : null;

  return {
    source,
    message: source === "auth-flow" ? safeAuthMessage : "fatal-js-error",
    name: source === "fatal-js-error" ? "FatalJavaScriptError" : safeName,
    isFatal: source === "fatal-js-error" ? true : false,
    timestamp: safeTimestamp,
    platform: safePlatform,
    platformVersion: safePlatformVersion,
    appVersion: safeAppVersion,
    buildNumber: safeBuildNumber,
    requestId: safeRequestId,
    release,
  };
}

/**
 * POST /client-logs
 *
 * Best-effort, unauthenticated diagnostic sink for the mobile app. Used to
 * report a fatal JS error that was persisted on-device right before the app
 * crashed (RN's ErrorUtils global handler fires just before RCTFatal aborts
 * the process), then uploaded on the next launch. No auth is required
 * because a crash can happen before the user is signed in.
 *
 * Native release events may include a safe build identity (track, host names,
 * and a short configuration fingerprint). They must never include credentials,
 * email addresses, response bodies, or raw exception messages. Always returns
 * 204, even on malformed input — a broken diagnostics call must never surface
 * as an error to the client or affect app behavior.
 */
router.post("/client-logs", (req, res) => {
  const parsed = ReportClientLogBody.safeParse(req.body);

  if (!parsed.success) {
    logger.warn(
      {
        issueCodes: parsed.error.issues.map((issue) => issue.code),
        issuePaths: parsed.error.issues.map((issue) => issue.path.join(".")),
      },
      "client-logs: received malformed payload",
    );
    res.status(204).send();
    return;
  }

  if (parsed.data.source === "auth-flow") {
    const authFlow = getSafeAuthFlowDiagnostic(parsed.data);
    if (!authFlow || parsed.data.stack) {
      logger.warn("client-logs: discarded malformed auth-flow diagnostic");
      res.status(204).send();
      return;
    }

    logger.info(
      { authFlow },
      "client-logs: auth-flow diagnostic reported",
    );
    res.status(204).send();
    return;
  }

  if (parsed.data.source === "render-error") {
    const diagnostic = getSafeRenderErrorDiagnostic(parsed.data);
    if (!diagnostic) {
      logger.warn("client-logs: discarded malformed render-error diagnostic");
      res.status(204).send();
      return;
    }
    logger.error(
      { renderError: diagnostic },
      "client-logs: render error reported by client",
    );
    res.status(204).send();
    return;
  }

  if (parsed.data.source === "fatal-js-error") {
    const diagnostic = safeDiagnosticLog(parsed.data);
    logger.error(
      { clientLog: diagnostic },
      "client-logs: fatal JS error reported by client",
    );
    recordFatalCrashSignal(diagnostic);
  } else {
    logger.warn(
      { clientLog: safeDiagnosticLog(parsed.data) },
      "client-logs: client diagnostic reported",
    );
  }
  res.status(204).send();
});

export default router;
