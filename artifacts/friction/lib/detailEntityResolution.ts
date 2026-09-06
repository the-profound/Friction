export type DetailEntity = "thought" | "article";
export type DetailRequestMode = "thought" | "dividing";

export type DetailQuerySnapshot<T> = {
  data?: T;
  error?: unknown;
  isError: boolean;
  isLoading: boolean;
};

type DividingArticle = {
  status?: string | null;
};

/**
 * Why a detail lookup ended in failure, used to pick user-facing copy and to
 * decide whether "다시 시도" is worth automating.
 *
 * - "not-found": the server confirmed the record itself does not exist
 *   (structured 404 body, e.g. `{ error: "Thought not found" }`).
 * - "not-implemented": a 404 with no structured API error body — the route
 *   itself is missing (older client hitting a server that doesn't expose this
 *   lookup yet), not a missing record.
 * - "auth": the session is not authorized (401/403) — likely expired.
 * - "connection": network/timeout/server errors — plausibly transient.
 * - "not-dividing": the article exists but isn't in DIVIDING status, so it
 *   isn't valid for this dividing-mode route.
 */
export type DetailErrorReason =
  | "not-found"
  | "not-implemented"
  | "auth"
  | "connection"
  | "not-dividing";

export type DetailEntityResolution<TThought, TArticle extends DividingArticle> =
  | {
      kind: "loading";
      entity: DetailEntity;
    }
  | {
      kind: "success";
      entity: "thought";
      thought: TThought;
    }
  | {
      kind: "success";
      entity: "article";
      article: TArticle;
    }
  | {
      kind: "error";
      entity: DetailEntity;
      error?: unknown;
      reason: DetailErrorReason;
      retryEntity: DetailEntity;
    };

// ── error classification ────────────────────────────────────────────────────
//
// customFetch throws ApiError (`{ status, data, ... }`) for any non-2xx HTTP
// response, and plain Errors (TypeError, AbortError/TimeoutError) for
// failures that never reached the server. This module stays free of any
// dependency on the api-client package and duck-types both shapes instead.

function hasNumericStatus(error: unknown): error is { status: number; data?: unknown } {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    typeof (error as { status?: unknown }).status === "number"
  );
}

/** True only when the 404 came with a structured (JSON object) API error body. */
function hasStructuredErrorBody(error: { data?: unknown }): boolean {
  return typeof error.data === "object" && error.data !== null;
}

function isTimeoutOrAbort(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function isNetworkFailure(error: unknown): boolean {
  if (isTimeoutOrAbort(error)) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof Error) {
    const message = error.message.toLowerCase();
    if (message.includes("network") || message.includes("failed to fetch")) return true;
  }
  return false;
}

/** A 404 regardless of body shape — used only to decide routing (try the other entity next). */
function isNotFound(error: unknown): boolean {
  return hasNumericStatus(error) && error.status === 404;
}

/** Classifies a terminal (already-decided-to-be-final) failure for user-facing copy. */
export function classifyDetailError(error: unknown): DetailErrorReason {
  if (isNetworkFailure(error)) return "connection";
  if (hasNumericStatus(error)) {
    const { status } = error;
    if (status === 401 || status === 403) return "auth";
    if (status === 404) {
      return hasStructuredErrorBody(error) ? "not-found" : "not-implemented";
    }
    if (status >= 500) return "connection";
  }
  return "connection";
}

/** Only network/timeout/5xx failures are plausibly transient; everything else won't improve on retry. */
export function isRetryableDetailError(error: unknown): boolean {
  if (isNetworkFailure(error)) return true;
  if (hasNumericStatus(error) && error.status >= 500) return true;
  return false;
}

/**
 * True only for a definitive "this doesn't exist / isn't valid anymore"
 * response — used by the question-activation flow to decide whether it's
 * honest to tell the user the item is gone and navigate them away. A
 * network blip, timeout, 5xx, or expired session is NOT this: those must
 * leave the user able to retry, not be told something was deleted that may
 * simply have failed to load.
 *
 * Requires a *structured* error body on top of the 404/409 status, for the
 * same reason `classifyDetailError` does for 404s: an unstructured 404/409
 * (e.g. a stale client hitting a server build where the activate route
 * itself no longer exists, or a proxy/gateway response) is a version-skew
 * or infra problem, not the server confirming the question is gone.
 */
export function isConfirmedGoneError(error: unknown): boolean {
  return (
    hasNumericStatus(error) &&
    (error.status === 404 || error.status === 409) &&
    hasStructuredErrorBody(error)
  );
}

const MAX_DETAIL_QUERY_RETRIES = 2;

/** React Query `retry` option: bounded auto-retry for transient failures only. */
export function shouldRetryDetailQuery(failureCount: number, error: unknown): boolean {
  return failureCount < MAX_DETAIL_QUERY_RETRIES && isRetryableDetailError(error);
}

/** React Query `retryDelay` option: short, capped backoff so a stuck screen resolves quickly. */
export function detailQueryRetryDelayMs(attemptIndex: number): number {
  return Math.min(400 * 2 ** attemptIndex, 1500);
}

function resolveArticle<TThought, TArticle extends DividingArticle>(
  article: DetailQuerySnapshot<TArticle>,
  options?: { suppressNotDividingError?: boolean },
): DetailEntityResolution<TThought, TArticle> {
  if (article.data?.status === "DIVIDING") {
    return { kind: "success", entity: "article", article: article.data };
  }

  if (article.isError) {
    return {
      kind: "error",
      entity: "article",
      error: article.error,
      reason: classifyDetailError(article.error),
      retryEntity: "article",
    };
  }

  if (article.data) {
    // A caller can be mid-way through its own intentional forward transition
    // (e.g. review → closing), having already optimistically patched this
    // same article's status away from "DIVIDING" before navigation actually
    // lands. That self-inflicted mismatch is not a real "this article is
    // gone" state — surfacing the not-dividing error here would flash a
    // false failure screen for the one render before the route change
    // completes. The caller opts into this suppression only while its own
    // transition is in flight, so a genuinely stale/invalid article (one the
    // caller did not just optimistically move itself) is unaffected.
    if (options?.suppressNotDividingError) {
      return { kind: "loading", entity: "article" };
    }
    return { kind: "error", entity: "article", reason: "not-dividing", retryEntity: "article" };
  }

  // Not yet resolved: either actively fetching, or not started yet (e.g. the
  // query is disabled while auth restoration is in progress). Both must
  // present as "loading" — never guess at a terminal state before the query
  // has actually run.
  return { kind: "loading", entity: "article" };
}

export function resolveDetailEntity<TThought, TArticle extends DividingArticle>({
  requestMode,
  thought,
  article,
  suppressNotDividingError,
}: {
  requestMode: DetailRequestMode;
  thought: DetailQuerySnapshot<TThought>;
  article: DetailQuerySnapshot<TArticle>;
  /**
   * Set while the caller has just staged its own optimistic forward
   * transition away from the "DIVIDING" status it depends on (e.g. review →
   * closing) and is about to navigate away. Suppresses the resulting
   * "not-dividing" false positive for that one in-between render without
   * masking a genuine query error or a real, externally-caused mismatch.
   */
  suppressNotDividingError?: boolean;
}): DetailEntityResolution<TThought, TArticle> {
  if (requestMode === "dividing") {
    return resolveArticle(article, { suppressNotDividingError });
  }

  if (thought.data) {
    return { kind: "success", entity: "thought", thought: thought.data };
  }

  if (thought.isError) {
    // Only a *structured* thought 404 ("no thought with this id") is safe to
    // treat as "try the article instead" — that's the expected shape when a
    // direct article route reaches this screen without `mode=dividing`. An
    // unstructured 404 means the `/thoughts/:id` route itself is missing
    // (server/client version skew), which is a terminal, unrelated failure:
    // falling through to the article lookup would let a real article 404
    // masquerade as "not-implemented", or a real "not-implemented" get
    // overwritten by whatever the article lookup happens to return.
    if (isNotFound(thought.error) && hasStructuredErrorBody(thought.error as { data?: unknown })) {
      return resolveArticle(article, { suppressNotDividingError });
    }
    return {
      kind: "error",
      entity: "thought",
      error: thought.error,
      reason: classifyDetailError(thought.error),
      retryEntity: "thought",
    };
  }

  // Not yet resolved: either actively fetching, or not started yet (e.g. the
  // query is disabled while auth restoration is in progress).
  return { kind: "loading", entity: "thought" };
}
