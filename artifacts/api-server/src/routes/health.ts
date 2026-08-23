import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "drizzle-orm";
import { HealthCheckResponse } from "@workspace/api-zod";
import { db } from "@workspace/db";
import {
  getSupabaseEnvironmentInspection,
  type SupabaseEnvironmentInspection,
} from "../lib/supabaseEnvironment";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.get("/healthz", (_req, res) => {
  const data = HealthCheckResponse.parse({ status: "ok" });
  res.json(data);
});

export interface ReadinessDependencies {
  inspect?: () => SupabaseEnvironmentInspection;
  pingDatabase?: () => Promise<unknown>;
}

export function createReadinessHandler({
  inspect = getSupabaseEnvironmentInspection,
  pingDatabase = () => db.execute(sql`select 1`),
}: ReadinessDependencies = {}) {
  return async (_req: Request, res: Response) => {
    const inspection = inspect();
    if (inspection.status !== "ready") {
      logger.error({ readinessCode: inspection.status }, "readiness check failed");
      res.status(503).json({ status: "unavailable", code: inspection.status });
      return;
    }

    try {
      await Promise.race([
        pingDatabase(),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error("database readiness timeout")), 3_000),
        ),
      ]);
      res.json({ status: "ready" });
    } catch {
      logger.error({ readinessCode: "DATABASE_UNAVAILABLE" }, "readiness check failed");
      res.status(503).json({ status: "unavailable", code: "DATABASE_UNAVAILABLE" });
    }
  };
}

router.get("/readyz", createReadinessHandler());

export default router;
