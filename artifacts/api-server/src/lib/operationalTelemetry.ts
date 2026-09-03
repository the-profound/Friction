import { randomUUID } from "crypto";
import type { Request, RequestHandler } from "express";
import type { Logger } from "pino";

export const REQUEST_ID_HEADER = "x-request-id";
export const SLOW_REQUEST_MS = 2_000;
export const SCHEDULED_SEND_DELAY_ALERT_MS = 10 * 60 * 1_000;
export const ERROR_RATE_WINDOW_MS = 5 * 60 * 1_000;
export const ERROR_RATE_MIN_REQUESTS = 20;
export const ERROR_RATE_ALERT_RATIO = 0.2;

const SAFE_REQUEST_ID = /^req_[a-z0-9]{20,32}$/;

type LogLike = Pick<Logger, "info" | "warn" | "error">;

export type OperationalOutcome = "success" | "failure" | "degraded" | "denied";

export interface OperationalMetric {
  operation:
    | "api.request"
    | "auth.verify"
    | "db.readiness"
    | "scheduler.scheduled-send"
    | "scheduler.letter-push"
    | "scheduler.inactive-space"
    | "scheduler.round-status"
    | "storage.inline-upload"
    | "storage.signed-url"
    | "storage.download"
    | "push.send";
  outcome: OperationalOutcome;
  durationMs: number;
  correlationId?: string;
  failureType?: string;
  statusCode?: number;
  count?: number;
  successCount?: number;
  failureCount?: number;
  delayedCount?: number;
  maxDelayMs?: number;
}

export function createCorrelationId(): string {
  return `req_${randomUUID().replaceAll("-", "")}`;
}

export function isSafeCorrelationId(value: unknown): value is string {
  return typeof value === "string" && SAFE_REQUEST_ID.test(value);
}

export function getCorrelationId(req: Pick<Request, "id">): string {
  return isSafeCorrelationId(req.id) ? req.id : createCorrelationId();
}

export function classifyOperationalError(error: unknown): string {
  if (!error || typeof error !== "object") return "unknown";
  const candidate = error as { name?: unknown; code?: unknown; status?: unknown };
  if (candidate.name === "AbortError" || candidate.name === "TimeoutError") return "timeout";
  if (candidate.name === "ObjectNotFoundError") return "not_found";
  if (candidate.name === "InvalidCoverImageError") return "invalid_object";
  if (typeof candidate.code === "string") {
    if (candidate.code.startsWith("23")) return "db_constraint";
    if (candidate.code.startsWith("08")) return "db_connection";
    if (/^[A-Z0-9_]{2,40}$/.test(candidate.code)) return candidate.code.toLowerCase();
  }
  if (typeof candidate.status === "number") return `upstream_${Math.floor(candidate.status / 100)}xx`;
  return typeof candidate.name === "string" && /^[A-Za-z]+Error$/.test(candidate.name)
    ? candidate.name.replace(/Error$/, "").toLowerCase()
    : "unknown";
}

export function logOperationalMetric(log: LogLike, metric: OperationalMetric): void {
  const payload = {
    event: "operational.metric",
    ...metric,
    durationMs: Math.max(0, Math.round(metric.durationMs)),
  };
  if (metric.outcome === "failure") {
    log.error(payload, `operational metric: ${metric.operation}`);
  } else if (
    metric.outcome === "degraded" ||
    metric.durationMs >= SLOW_REQUEST_MS ||
    (metric.maxDelayMs ?? 0) >= SCHEDULED_SEND_DELAY_ALERT_MS
  ) {
    log.warn(payload, `operational metric: ${metric.operation}`);
  } else {
    log.info(payload, `operational metric: ${metric.operation}`);
  }

  if (metric.operation === "db.readiness" && metric.outcome === "failure") {
    log.error(
      { event: "operational.alert", alertType: "readiness_failed", correlationId: metric.correlationId },
      "operational alert: readiness failed",
    );
  }
  if (
    metric.operation === "scheduler.scheduled-send" &&
    (metric.outcome === "failure" || (metric.maxDelayMs ?? 0) >= SCHEDULED_SEND_DELAY_ALERT_MS)
  ) {
    log.error(
      {
        event: "operational.alert",
        alertType: metric.outcome === "failure" ? "scheduled_send_failed" : "scheduled_send_delayed",
        correlationId: metric.correlationId,
        failureCount: metric.failureCount,
        delayedCount: metric.delayedCount,
        maxDelayMs: metric.maxDelayMs,
      },
      "operational alert: scheduled send impact detected",
    );
  }
  if (
    (metric.operation === "push.send" || metric.operation === "scheduler.letter-push") &&
    (metric.failureCount ?? 0) > 0
  ) {
    const total = (metric.successCount ?? 0) + (metric.failureCount ?? 0);
    const failureRatio = total > 0 ? (metric.failureCount ?? 0) / total : 0;
    if ((metric.successCount ?? 0) === 0 || failureRatio >= 0.2) {
      log.error(
        {
          event: "operational.alert",
          alertType: "push_failure_rate",
          correlationId: metric.correlationId,
          successCount: metric.successCount,
          failureCount: metric.failureCount,
          failureRatio: Number(failureRatio.toFixed(3)),
          thresholdRatio: 0.2,
        },
        "operational alert: push failure rate exceeded threshold",
      );
    }
  }
  if (metric.operation.startsWith("storage.") && metric.outcome === "failure") {
    const now = Date.now();
    if (now - storageFailureWindow.startedAt >= ERROR_RATE_WINDOW_MS) {
      storageFailureWindow = { startedAt: now, failures: 0, alerted: false };
    }
    storageFailureWindow.failures += 1;
    if (!storageFailureWindow.alerted && storageFailureWindow.failures >= 3) {
      storageFailureWindow.alerted = true;
      log.error(
        {
          event: "operational.alert",
          alertType: "storage_failures",
          windowMs: ERROR_RATE_WINDOW_MS,
          failureCount: storageFailureWindow.failures,
          thresholdCount: 3,
        },
        "operational alert: storage failures exceeded threshold",
      );
    }
  }
}

type ErrorRateWindow = { startedAt: number; requests: number; errors: number; alerted: boolean };
let requestWindow: ErrorRateWindow = {
  startedAt: Date.now(),
  requests: 0,
  errors: 0,
  alerted: false,
};
let storageFailureWindow = { startedAt: Date.now(), failures: 0, alerted: false };

function recordErrorRate(log: LogLike, statusCode: number, now = Date.now()): void {
  if (now - requestWindow.startedAt >= ERROR_RATE_WINDOW_MS) {
    requestWindow = { startedAt: now, requests: 0, errors: 0, alerted: false };
  }
  requestWindow.requests += 1;
  if (statusCode >= 500) requestWindow.errors += 1;
  const ratio = requestWindow.errors / requestWindow.requests;
  if (
    !requestWindow.alerted &&
    requestWindow.requests >= ERROR_RATE_MIN_REQUESTS &&
    ratio >= ERROR_RATE_ALERT_RATIO
  ) {
    requestWindow.alerted = true;
    log.error(
      {
        event: "operational.alert",
        alertType: "api_error_rate",
        windowMs: ERROR_RATE_WINDOW_MS,
        requestCount: requestWindow.requests,
        errorCount: requestWindow.errors,
        errorRatio: Number(ratio.toFixed(3)),
        thresholdRatio: ERROR_RATE_ALERT_RATIO,
      },
      "operational alert: API error rate exceeded threshold",
    );
  }
}

export const correlationIdMiddleware: RequestHandler = (req, res, next) => {
  const inbound = req.header(REQUEST_ID_HEADER);
  const correlationId = isSafeCorrelationId(inbound) ? inbound : createCorrelationId();
  req.id = correlationId;
  res.setHeader(REQUEST_ID_HEADER, correlationId);
  next();
};

export const apiRequestTelemetryMiddleware: RequestHandler = (req, res, next) => {
  const startedAt = performance.now();
  res.once("finish", () => {
    const durationMs = performance.now() - startedAt;
    const statusCode = res.statusCode;
    const outcome: OperationalOutcome =
      statusCode >= 500 ? "failure" : statusCode >= 400 ? "denied" : "success";
    logOperationalMetric(req.log, {
      operation: "api.request",
      outcome,
      durationMs,
      correlationId: getCorrelationId(req),
      statusCode,
      failureType:
        statusCode >= 500 ? "http_5xx" : statusCode >= 400 ? "http_4xx" : undefined,
    });
    recordErrorRate(req.log, statusCode);
  });
  next();
};

export function resetOperationalTelemetryForTests(): void {
  requestWindow = { startedAt: Date.now(), requests: 0, errors: 0, alerted: false };
  storageFailureWindow = { startedAt: Date.now(), failures: 0, alerted: false };
}