import { createClient } from "@supabase/supabase-js";
import type { RequestHandler } from "express";
import {
  getCorrelationId,
  logOperationalMetric,
} from "../lib/operationalTelemetry";
import { logger } from "../lib/logger";

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL ?? "";
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "";

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error(
    "EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_ANON_KEY must be set for auth middleware",
  );
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

declare global {
  namespace Express {
    interface Request {
      user?: { id: string; email?: string };
    }
  }
}

export interface AuthenticatedUser {
  id: string;
  email?: string;
}

export interface RequireAuthOptions {
  getUser?: (token: string) => Promise<{ data: { user: AuthenticatedUser | null }; error: unknown }>;
  timeoutMs?: number;
}

export function createRequireAuth({
  getUser = (token) => supabase.auth.getUser(token),
  timeoutMs = 10_000,
}: RequireAuthOptions = {}): RequestHandler {
  return async (req, res, next) => {
  const startedAt = performance.now();
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    logOperationalMetric(req.log ?? logger, {
      operation: "auth.verify",
      outcome: "denied",
      durationMs: performance.now() - startedAt,
      correlationId: getCorrelationId(req),
      failureType: "auth_required",
    });
    res.status(401).json({ error: "Authentication required", code: "AUTH_REQUIRED" });
    return;
  }
  const token = authHeader.slice(7);

  let getUserResult: Awaited<ReturnType<typeof getUser>>;
  try {
    getUserResult = await Promise.race([
      getUser(token),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Authentication service timeout")),
          timeoutMs,
        ),
      ),
    ]);
  } catch {
    logOperationalMetric(req.log ?? logger, {
      operation: "auth.verify",
      outcome: "failure",
      durationMs: performance.now() - startedAt,
      correlationId: getCorrelationId(req),
      failureType: "auth_unavailable",
    });
    res.status(503).json({
      error: "Authentication service is temporarily unavailable",
      code: "AUTH_UNAVAILABLE",
    });
    return;
  }

  const { data, error } = getUserResult;
  if (error || !data.user) {
    logOperationalMetric(req.log ?? logger, {
      operation: "auth.verify",
      outcome: "denied",
      durationMs: performance.now() - startedAt,
      correlationId: getCorrelationId(req),
      failureType: "auth_invalid",
    });
    res.status(401).json({ error: "Invalid or expired token", code: "AUTH_INVALID" });
    return;
  }
  req.user = { id: data.user.id, email: data.user.email ?? undefined };
  logOperationalMetric(req.log ?? logger, {
    operation: "auth.verify",
    outcome: "success",
    durationMs: performance.now() - startedAt,
    correlationId: getCorrelationId(req),
  });
  next();
  };
};

export const requireAuth = createRequireAuth();

/**
 * Resolves the caller's user ID from a Bearer token without rejecting the
 * request when auth is missing or invalid. Use this for endpoints that are
 * public but grant extra data to authenticated owners.
 */
export async function resolveCallerId(req: { headers: { authorization?: string } }): Promise<string | null> {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) return null;
  try {
    const { data } = await supabase.auth.getUser(authHeader.slice(7));
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}
