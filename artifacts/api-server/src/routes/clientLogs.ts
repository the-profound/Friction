import { Router, type IRouter } from "express";
import { ReportClientLogBody, type ClientLogBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

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

  if (parsed.data.source === "fatal-js-error") {
    logger.error(
      { clientLog: safeDiagnosticLog(parsed.data) },
      "client-logs: fatal JS error reported by client",
    );
  } else {
    logger.warn(
      { clientLog: safeDiagnosticLog(parsed.data) },
      "client-logs: client diagnostic reported",
    );
  }
  res.status(204).send();
});

export default router;
