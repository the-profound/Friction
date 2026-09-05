import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import {
  GetServerVersionResponse,
  HealthCheckResponse,
  type ServerFeature,
} from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  getSupabaseEnvironmentInspection,
  type SupabaseEnvironmentInspection,
} from "../lib/supabaseEnvironment";
import { logger } from "../lib/logger";
import {
  getCorrelationId,
  logOperationalMetric,
} from "../lib/operationalTelemetry";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

// Opaque per-process identifier, captured once when this module loads (server
// startup). It is not a semantic version — it only lets a client tell "the
// server I'm talking to restarted since I last checked" apart from "it is
// still the same long-running process". Computed purely at runtime (no git/
// filesystem dependency) so it is always available in every environment,
// including deployed containers that may not ship `.git`.
const SERVER_BUILD_ID = new Date().toISOString();

// Operations the currently running server build supports. Update this list in
// lockstep with the ServerFeature enum in openapi.yaml whenever a client
// starts depending on a newly added operation that an older deployed server
// would not have. Do not add an entry until the route actually exists here.
const SUPPORTED_SERVER_FEATURES: readonly ServerFeature[] = [
  "getThoughtQuestionQueue",
  "refreshThoughtQuestionQueue",
  "activateThoughtQuestion",
  "getThought",
];

router.get("/version", (_req, res) => {
  const data = GetServerVersionResponse.parse({
    buildId: SERVER_BUILD_ID,
    features: SUPPORTED_SERVER_FEATURES,
  });
  res.json(data);
});

export interface ReadinessDependencies {
  inspect?: () => SupabaseEnvironmentInspection;
  pingDatabase?: () => Promise<unknown>;
  timeoutMs?: number;
}

export function createReadinessHandler({
  inspect = getSupabaseEnvironmentInspection,
  pingDatabase = () => db.execute(sql`select 1`),
  timeoutMs = 3_000,
}: ReadinessDependencies = {}) {
  return async (req: Request, res: Response) => {
    const startedAt = performance.now();
    const inspection = inspect();
    if (inspection.status !== "ready") {
      logOperationalMetric(req.log ?? logger, {
        operation: "db.readiness",
        outcome: "failure",
        durationMs: performance.now() - startedAt,
        correlationId: getCorrelationId(req),
        failureType: inspection.status,
      });
      res.status(503).json({ status: "unavailable", code: inspection.status });
      return;
    }

    try {
      await Promise.race([
        pingDatabase(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("database readiness timeout")), timeoutMs),
        ),
      ]);
      logOperationalMetric(req.log ?? logger, {
        operation: "db.readiness",
        outcome: "success",
        durationMs: performance.now() - startedAt,
        correlationId: getCorrelationId(req),
      });
      res.json({ status: "ready" });
    } catch (error) {
      logOperationalMetric(req.log ?? logger, {
        operation: "db.readiness",
        outcome: "failure",
        durationMs: performance.now() - startedAt,
        correlationId: getCorrelationId(req),
        failureType: error instanceof Error && error.message === "database readiness timeout"
          ? "database_timeout"
          : "database_unavailable",
      });
      res.status(503).json({ status: "unavailable", code: "DATABASE_UNAVAILABLE" });
    }
  };
}

router.get("/readyz", createReadinessHandler());

export default router;
