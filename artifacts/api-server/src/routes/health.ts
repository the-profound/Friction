import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
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
