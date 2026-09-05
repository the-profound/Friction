import type { ServerFeature, ServerVersion } from "@workspace/api-client-react";

/**
 * Server-side features this app build calls directly. Keep this in sync with
 * `SUPPORTED_SERVER_FEATURES` in artifacts/api-server/src/routes/health.ts —
 * add an entry here only once the corresponding route is actually live on
 * the server this app talks to.
 *
 * This is what lets a stale deployed server (missing routes the current app
 * code needs) be detected as one clear "version mismatch" instead of
 * surfacing as scattered, unexplained per-feature failures.
 */
export const REQUIRED_SERVER_FEATURES: readonly ServerFeature[] = [
  "getThoughtQuestionQueue",
  "refreshThoughtQuestionQueue",
  "activateThoughtQuestion",
  "getThought",
];

export type ServerVersionEvaluation =
  | { status: "compatible"; buildId: string }
  | {
      status: "mismatch";
      reason: "missing-features";
      buildId: string;
      missingFeatures: ServerFeature[];
    }
  | { status: "mismatch"; reason: "version-endpoint-missing"; buildId: null }
  | { status: "unknown"; buildId: null };

/**
 * True only for a structurally-shaped 404 ApiError (as thrown by
 * `@workspace/api-client-react`'s customFetch). Checked by shape rather than
 * `instanceof` so this keeps working even if module duplication across the
 * monorepo ever produces more than one ApiError class identity.
 */
function isVersionEndpointMissing(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as { status?: unknown; name?: unknown };
  return candidate.status === 404 && candidate.name === "ApiError";
}

/** Evaluates a successfully-fetched /version response. */
export function evaluateServerVersionResult(
  version: ServerVersion,
): ServerVersionEvaluation {
  const buildId = typeof version?.buildId === "string" ? version.buildId : null;
  if (!buildId) {
    // Malformed response (server violated its own contract). Treat as
    // "unknown" rather than guessing — never claim compatibility or
    // mismatch from data we can't actually trust.
    return { status: "unknown", buildId: null };
  }

  const features = Array.isArray(version.features) ? version.features : [];
  const missingFeatures = REQUIRED_SERVER_FEATURES.filter(
    (feature) => !features.includes(feature),
  );

  if (missingFeatures.length > 0) {
    return { status: "mismatch", reason: "missing-features", buildId, missingFeatures };
  }
  return { status: "compatible", buildId };
}

/** Evaluates a failed /version request (network error, 404, 5xx, etc). */
export function evaluateServerVersionError(error: unknown): ServerVersionEvaluation {
  if (isVersionEndpointMissing(error)) {
    // The server doesn't even know about /version yet — necessarily older
    // than the app, and by definition missing every required feature.
    return { status: "mismatch", reason: "version-endpoint-missing", buildId: null };
  }
  // Any other failure (offline, timeout, 5xx, DNS) is not evidence of a
  // version mismatch — showing the mismatch notice here would mislabel
  // ordinary connectivity issues, so stay silent instead.
  return { status: "unknown", buildId: null };
}
