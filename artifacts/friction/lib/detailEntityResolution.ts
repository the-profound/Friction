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
      reason: "not-found" | "request-failed" | "not-dividing";
      retryEntity: DetailEntity;
    };

function isNotFound(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    (error as { status?: unknown }).status === 404
  );
}

function resolveArticle<TThought, TArticle extends DividingArticle>(
  article: DetailQuerySnapshot<TArticle>,
): DetailEntityResolution<TThought, TArticle> {
  if (article.data?.status === "DIVIDING") {
    return { kind: "success", entity: "article", article: article.data };
  }

  if (article.isLoading) {
    return { kind: "loading", entity: "article" };
  }

  if (article.data) {
    return {
      kind: "error",
      entity: "article",
      reason: "not-dividing",
      retryEntity: "article",
    };
  }

  return {
    kind: "error",
    entity: "article",
    error: article.error,
    reason: isNotFound(article.error) ? "not-found" : "request-failed",
    retryEntity: "article",
  };
}

/**
 * Resolves the real detail entity independently from the order in which the
 * two detail requests finish. A thought route treats article 404 as expected;
 * a dividing route always requires a real DIVIDING article.
 */
export function resolveDetailEntity<TThought, TArticle extends DividingArticle>({
  requestMode,
  thought,
  article,
}: {
  requestMode: DetailRequestMode;
  thought: DetailQuerySnapshot<TThought>;
  article: DetailQuerySnapshot<TArticle>;
}): DetailEntityResolution<TThought, TArticle> {
  if (requestMode === "dividing") {
    return resolveArticle<TThought, TArticle>(article);
  }

  if (thought.data) {
    return { kind: "success", entity: "thought", thought: thought.data };
  }

  if (thought.isLoading) {
    return { kind: "loading", entity: "thought" };
  }

  if (thought.isError && !isNotFound(thought.error)) {
    return {
      kind: "error",
      entity: "thought",
      error: thought.error,
      reason: "request-failed",
      retryEntity: "thought",
    };
  }

  // A thought 404 is the expected result when an older/direct article route
  // reaches this screen without `mode=dividing`, so resolve the article next.
  if (thought.isError && isNotFound(thought.error)) {
    return resolveArticle<TThought, TArticle>(article);
  }

  return { kind: "loading", entity: "thought" };
}