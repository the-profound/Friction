import { Router, type IRouter } from "express";
import { ReportClientLogBody } from "@workspace/api-zod";
import { logger } from "../lib/logger";

const router: IRouter = Router();

/**
 * POST /client-logs
 *
 * Best-effort, unauthenticated diagnostic sink for the mobile app. Used to
 * report a fatal JS error that was persisted on-device right before the app
 * crashed (RN's ErrorUtils global handler fires just before RCTFatal aborts
 * the process), then uploaded on the next launch. No auth is required
 * because a crash can happen before the user is signed in.
 *
 * Always returns 204, even on malformed input — a broken diagnostics call
 * must never surface as an error to the client or affect app behavior.
 */
router.post("/client-logs", (req, res) => {
  const parsed = ReportClientLogBody.safeParse(req.body);

  if (!parsed.success) {
    logger.warn(
      { body: req.body, issues: parsed.error.issues },
      "client-logs: received malformed payload",
    );
    res.status(204).send();
    return;
  }

  if (parsed.data.source === "fatal-js-error") {
    logger.error({ clientLog: parsed.data }, "client-logs: fatal JS error reported by client");
  } else {
    logger.warn({ clientLog: parsed.data }, "client-logs: client diagnostic reported");
  }
  res.status(204).send();
});

export default router;
