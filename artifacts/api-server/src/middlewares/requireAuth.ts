import { createClient } from "@supabase/supabase-js";
import type { RequestHandler } from "express";

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
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
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
    res.status(503).json({
      error: "Authentication service is temporarily unavailable",
      code: "AUTH_UNAVAILABLE",
    });
    return;
  }

  const { data, error } = getUserResult;
  if (error || !data.user) {
    res.status(401).json({ error: "Invalid or expired token", code: "AUTH_INVALID" });
    return;
  }
  req.user = { id: data.user.id, email: data.user.email ?? undefined };
  next();
  };
};

export const requireAuth = createRequireAuth();
