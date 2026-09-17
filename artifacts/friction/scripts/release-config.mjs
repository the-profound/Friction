import { createHash } from "node:crypto";

const INVALID_VALUES = new Set([
  "",
  "placeholder",
  "placeholder-anon-key",
  "configuration-invalid",
  "undefined",
  "null",
]);

export const RELEASE_TRACKS = ["development", "preview", "production"];
export const BUILD_PROFILE_TRACKS = {
  development: "development",
  preview: "preview",
  test: "production",
};
export const RELEASE_REQUIRED_VARIABLES = [
  "EXPO_PUBLIC_SUPABASE_URL",
  "EXPO_PUBLIC_SUPABASE_ANON_KEY",
  "EXPO_PUBLIC_DOMAIN",
  "EXPO_PUBLIC_POSTHOG_TOKEN",
  "EXPO_PUBLIC_POSTHOG_HOST",
];

function hash(value) {
  return createHash("sha256").update(value).digest("hex");
}

function isInvalidValue(value) {
  return INVALID_VALUES.has((value ?? "").trim().toLowerCase());
}

function parseReleaseUrl(value, { allowDomainOnly = false } = {}) {
  if (isInvalidValue(value)) return null;

  const normalized = allowDomainOnly && !/^https?:\/\//i.test(value.trim())
    ? `https://${value.trim()}`
    : value.trim();

  try {
    const url = new URL(normalized);
    if (
      url.protocol !== "https:" ||
      !url.hostname ||
      url.username ||
      url.password ||
      url.pathname !== "/" ||
      url.search ||
      url.hash ||
      url.hostname.toLowerCase().includes("placeholder") ||
      url.hostname.toLowerCase().endsWith(".invalid")
    ) {
      return null;
    }
    return url;
  } catch {
    return null;
  }
}

export function resolveReleaseTrack(env = process.env) {
  const profile = env.EAS_BUILD_PROFILE?.trim();
  const declaredTrack = env.APP_RELEASE_TRACK?.trim();

  if (profile && BUILD_PROFILE_TRACKS[profile]) return BUILD_PROFILE_TRACKS[profile];
  if (declaredTrack && RELEASE_TRACKS.includes(declaredTrack)) return declaredTrack;
  return env.APP_VARIANT === "development" ? "development" : "development";
}

export function buildReleaseConfigSummary(env = process.env, expectedTrack) {
  const track = resolveReleaseTrack(env);
  const declaredTrack = env.APP_RELEASE_TRACK?.trim() ?? "";
  const issues = [];

  if (expectedTrack && track !== expectedTrack) {
    issues.push("release track does not match the requested profile");
  }
  if (
    env.EAS_BUILD_PROFILE &&
    BUILD_PROFILE_TRACKS[env.EAS_BUILD_PROFILE] &&
    declaredTrack !== BUILD_PROFILE_TRACKS[env.EAS_BUILD_PROFILE]
  ) {
    issues.push("APP_RELEASE_TRACK does not match EAS_BUILD_PROFILE");
  }

  const supabaseUrl = parseReleaseUrl(env.EXPO_PUBLIC_SUPABASE_URL);
  const apiUrl = parseReleaseUrl(env.EXPO_PUBLIC_DOMAIN ?? "", { allowDomainOnly: true });
  const anonKey = env.EXPO_PUBLIC_SUPABASE_ANON_KEY?.trim() ?? "";
  const posthogToken = env.EXPO_PUBLIC_POSTHOG_TOKEN?.trim() ?? "";
  const posthogUrl = parseReleaseUrl(env.EXPO_PUBLIC_POSTHOG_HOST ?? "");

  if (!supabaseUrl) issues.push("EXPO_PUBLIC_SUPABASE_URL");
  if (isInvalidValue(anonKey)) issues.push("EXPO_PUBLIC_SUPABASE_ANON_KEY");
  if (!apiUrl) issues.push("EXPO_PUBLIC_DOMAIN");
  if (isInvalidValue(posthogToken)) issues.push("EXPO_PUBLIC_POSTHOG_TOKEN");
  if (!posthogUrl) issues.push("EXPO_PUBLIC_POSTHOG_HOST");

  const supabaseHost = supabaseUrl?.hostname.toLowerCase() ?? null;
  const apiHost = apiUrl?.hostname.toLowerCase() ?? null;
  const anonKeyFingerprint = isInvalidValue(anonKey) ? null : hash(anonKey).slice(0, 16);
  const posthogHost = posthogUrl?.hostname.toLowerCase() ?? null;
  const posthogTokenFingerprint = isInvalidValue(posthogToken)
    ? null
    : hash(posthogToken).slice(0, 16);
  const configurationFingerprint =
    supabaseHost && apiHost && anonKeyFingerprint && posthogHost && posthogTokenFingerprint
      ? hash(
          `${track}|${supabaseHost}|${apiHost}|${anonKeyFingerprint}|${posthogHost}|${posthogTokenFingerprint}`,
        ).slice(0, 16)
      : null;

  return {
    track,
    valid: issues.length === 0,
    issues: [...new Set(issues)],
    supabaseHost,
    apiHost,
    anonKeyFingerprint,
    posthogHost,
    posthogTokenFingerprint,
    configurationFingerprint,
  };
}