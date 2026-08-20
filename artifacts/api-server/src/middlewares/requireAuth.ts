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

export const requireAuth: RequestHandler = async (req, res, next) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith("Bearer ")) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  const token = authHeader.slice(7);

  const AUTH_TIMEOUT_MS = 10_000;
  let getUserResult: Awaited<ReturnType<typeof supabase.auth.getUser>>;
  try {
    getUserResult = await Promise.race([
      supabase.auth.getUser(token),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error("Authentication service timeout")),
          AUTH_TIMEOUT_MS,
        ),
      ),
    ]);
  } catch {
    res.status(503).json({ error: "Authentication service timeout" });
    return;
  }

  const { data, error } = getUserResult;
  if (error || !data.user) {
    res.status(401).json({ error: "Invalid or expired token" });
    return;
  }
  req.user = { id: data.user.id, email: data.user.email ?? undefined };
  next();
};
