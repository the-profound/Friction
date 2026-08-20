export interface RuntimeConfigInput {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  apiDomain?: string;
}

export interface RuntimeConfig {
  supabaseUrl: string | null;
  supabaseAnonKey: string | null;
  apiBaseUrl: string | null;
  issues: string[];
  errorMessage: string | null;
}

const INVALID_PLACEHOLDER_VALUES = new Set([
  "placeholder",
  "placeholder-anon-key",
  "configuration-invalid",
  "undefined",
  "null",
]);

function hasValue(value: string | undefined): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isPlaceholder(value: string): boolean {
  return INVALID_PLACEHOLDER_VALUES.has(value.trim().toLowerCase());
}

function parseHttpUrl(value: string): string | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return null;
    if (!url.hostname || url.username || url.password) return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    return null;
  }
}

export function normalizeApiBaseUrl(value: string | undefined): string | null {
  if (!hasValue(value) || isPlaceholder(value)) return null;

  const trimmed = value.trim();
  if (trimmed.startsWith("/")) return null;

  const parsed = parseHttpUrl(
    /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`,
  );
  if (!parsed) return null;

  const url = new URL(parsed);
  if (
    isPlaceholder(url.hostname) ||
    url.hostname.toLowerCase().includes("placeholder") ||
    url.hostname.toLowerCase().endsWith(".invalid")
  ) {
    return null;
  }
  if (url.pathname !== "/" || url.search || url.hash) return null;
  return parsed;
}

export function readRuntimeConfig(input: RuntimeConfigInput): RuntimeConfig {
  const issues: string[] = [];

  let supabaseUrl: string | null = null;
  if (!hasValue(input.supabaseUrl)) {
    issues.push("EXPO_PUBLIC_SUPABASE_URL");
  } else if (isPlaceholder(input.supabaseUrl)) {
    issues.push("EXPO_PUBLIC_SUPABASE_URL is a placeholder");
  } else {
    supabaseUrl = parseHttpUrl(input.supabaseUrl.trim());
    if (!supabaseUrl) issues.push("EXPO_PUBLIC_SUPABASE_URL is invalid");
  }

  let supabaseAnonKey: string | null = null;
  if (!hasValue(input.supabaseAnonKey)) {
    issues.push("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  } else if (isPlaceholder(input.supabaseAnonKey)) {
    issues.push("EXPO_PUBLIC_SUPABASE_ANON_KEY is a placeholder");
  } else {
    supabaseAnonKey = input.supabaseAnonKey.trim();
  }

  const apiBaseUrl = normalizeApiBaseUrl(input.apiDomain);
  if (!apiBaseUrl) {
    issues.push("EXPO_PUBLIC_DOMAIN");
  }

  return {
    supabaseUrl,
    supabaseAnonKey,
    apiBaseUrl,
    issues,
    errorMessage:
      issues.length > 0
        ? `앱 설정이 올바르지 않습니다. ${issues.join(", ")} 값을 확인해주세요.`
        : null,
  };
}

export const runtimeConfig = readRuntimeConfig({
  supabaseUrl: process.env.EXPO_PUBLIC_SUPABASE_URL,
  supabaseAnonKey: process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY,
  apiDomain: process.env.EXPO_PUBLIC_DOMAIN,
});