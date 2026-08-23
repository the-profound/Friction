export type SupabaseEnvironmentStatus =
  | "ready"
  | "AUTH_TARGET_INVALID"
  | "DATABASE_TARGET_INVALID"
  | "DATABASE_TARGET_UNVERIFIABLE"
  | "SUPABASE_PROJECT_MISMATCH";

export interface SupabaseEnvironmentInspection {
  status: SupabaseEnvironmentStatus;
}

function parsePostgresUrl(value: string | undefined): URL | null {
  if (!value?.trim()) return null;

  try {
    const normalized = /^(postgres|postgresql):\/\//i.test(value)
      ? value
      : `postgresql://${value}`;
    const url = new URL(normalized);
    return url.protocol === "postgres:" || url.protocol === "postgresql:"
      ? url
      : null;
  } catch {
    return null;
  }
}

function projectRefFromAuthUrl(value: string | undefined): string | null {
  try {
    const url = new URL(value ?? "");
    if (!/^https?:$/i.test(url.protocol)) return null;

    const match = /^([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname);
    return match?.[1]?.toLowerCase() ?? null;
  } catch {
    return null;
  }
}

function projectRefFromDatabaseUrl(value: string | undefined): string | null {
  const url = parsePostgresUrl(value);
  if (!url) return null;

  const directHost = /^db\.([a-z0-9-]+)\.supabase\.co$/i.exec(url.hostname);
  if (directHost?.[1]) return directHost[1].toLowerCase();

  // Supabase pooler endpoints do not include the project ref in the host, but
  // retain it in the standard `postgres.<project-ref>` role name.
  let username: string;
  try {
    username = decodeURIComponent(url.username);
  } catch {
    return null;
  }
  const poolerUser = /^postgres\.([a-z0-9-]+)$/i.exec(username);
  return poolerUser?.[1]?.toLowerCase() ?? null;
}

/**
 * Verifies only stable, non-secret target identifiers. It intentionally never
 * returns a URL, host name, connection string, key, email, or user id.
 */
export function inspectSupabaseEnvironment(input: {
  authUrl?: string;
  databaseUrl?: string;
}): SupabaseEnvironmentInspection {
  const authProjectRef = projectRefFromAuthUrl(input.authUrl);
  if (!authProjectRef) return { status: "AUTH_TARGET_INVALID" };

  const databaseUrl = parsePostgresUrl(input.databaseUrl);
  if (!databaseUrl) return { status: "DATABASE_TARGET_INVALID" };

  const databaseProjectRef = projectRefFromDatabaseUrl(input.databaseUrl);
  if (!databaseProjectRef) {
    return { status: "DATABASE_TARGET_UNVERIFIABLE" };
  }

  if (authProjectRef !== databaseProjectRef) {
    return { status: "SUPABASE_PROJECT_MISMATCH" };
  }

  return { status: "ready" };
}

export function getSupabaseEnvironmentInspection(): SupabaseEnvironmentInspection {
  return inspectSupabaseEnvironment({
    authUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
    databaseUrl: process.env.SUPABASE_DB_URL,
  });
}

/**
 * Called before serving traffic. A bad target must fail deployment rather than
 * making every new signup look like an ordinary profile-sync error.
 */
export function assertSupabaseEnvironmentIsReady(): void {
  const inspection = getSupabaseEnvironmentInspection();
  if (inspection.status !== "ready") {
    throw new Error(`Supabase environment configuration failed: ${inspection.status}`);
  }
}