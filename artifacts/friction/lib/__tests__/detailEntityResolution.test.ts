import { describe, expect, it } from "vitest";
import {
  classifyDetailError,
  detailQueryRetryDelayMs,
  isConfirmedGoneError,
  isRetryableDetailError,
  resolveDetailEntity,
  shouldRetryDetailQuery,
  type DetailQuerySnapshot,
} from "../detailEntityResolution";

type Thought = { id: string; content: string };
type Article = { id: string; status: string; content: string };

const loading = <T>(): DetailQuerySnapshot<T> => ({
  isError: false,
  isLoading: true,
});

// A real "record not found" response always carries a structured JSON error
// body (see `res.status(404).json({ error: ... })` on the server).
const missing = <T>(): DetailQuerySnapshot<T> => ({
  error: { status: 404, data: { error: "Not found" } },
  isError: true,
  isLoading: false,
});

// A 404 with no structured body is what an unmatched Express route produces
// (plain-text "Cannot GET ..."), i.e. the server doesn't expose this route yet.
const routeUnavailable = <T>(): DetailQuerySnapshot<T> => ({
  error: { status: 404, data: "Cannot GET /api/thoughts/x" },
  isError: true,
  isLoading: false,
});

const authExpired = <T>(): DetailQuerySnapshot<T> => ({
  error: { status: 401, data: { error: "Unauthorized" } },
  isError: true,
  isLoading: false,
});

const failed = <T>(): DetailQuerySnapshot<T> => ({
  error: { status: 500, data: { error: "Internal error" } },
  isError: true,
  isLoading: false,
});

const networkFailure = <T>(): DetailQuerySnapshot<T> => ({
  error: new TypeError("Network request failed"),
  isError: true,
  isLoading: false,
});

const success = <T>(data: T): DetailQuerySnapshot<T> => ({
  data,
  isError: false,
  isLoading: false,
});

describe("detail entity resolution", () => {
  it("keeps a successfully loaded thought open when the parallel article request returns 404", () => {
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: success<Thought>({ id: "thought-1", content: "저장된 단상" }),
      article: missing<Article>(),
    })).toMatchObject({
      kind: "success",
      entity: "thought",
      thought: { content: "저장된 단상" },
    });
  });

  it("waits for the thought result even when the article response arrives first", () => {
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: loading<Thought>(),
      article: success<Article>({ id: "article-1", status: "DIVIDING", content: "분할 글" }),
    })).toEqual({ kind: "loading", entity: "thought" });
  });

  it("treats a not-yet-started query (disabled, e.g. pending auth) as loading, not an error", () => {
    // Neither query has run yet (both disabled while auth restoration is in
    // progress): isLoading is false and isError is false, no data either.
    const notStarted = <T>(): DetailQuerySnapshot<T> => ({ isError: false, isLoading: false });

    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: notStarted<Thought>(),
      article: notStarted<Article>(),
    })).toEqual({ kind: "loading", entity: "thought" });

    expect(resolveDetailEntity({
      requestMode: "dividing",
      thought: notStarted<Thought>(),
      article: notStarted<Article>(),
    })).toEqual({ kind: "loading", entity: "article" });
  });

  it("opens a DIVIDING article after the thought lookup confirms its expected 404", () => {
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: missing<Thought>(),
      article: success<Article>({ id: "article-1", status: "DIVIDING", content: "분할 글" }),
    })).toMatchObject({
      kind: "success",
      entity: "article",
      article: { id: "article-1" },
    });
  });

  it("recovers a direct on-01a article route when mode=dividing was omitted", () => {
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: missing<Thought>(),
      article: success<Article>({ id: "article-1", status: "DIVIDING", content: "서버 본문" }),
    })).toEqual({
      kind: "success",
      entity: "article",
      article: { id: "article-1", status: "DIVIDING", content: "서버 본문" },
    });
  });

  it("uses article-only loading and failure states for a requested dividing route", () => {
    expect(resolveDetailEntity({
      requestMode: "dividing",
      thought: loading<Thought>(),
      article: loading<Article>(),
    })).toEqual({ kind: "loading", entity: "article" });

    expect(resolveDetailEntity({
      requestMode: "dividing",
      thought: success<Thought>({ id: "thought-1", content: "ignored" }),
      article: missing<Article>(),
    })).toMatchObject({
      kind: "error",
      entity: "article",
      reason: "not-found",
      retryEntity: "article",
    });
  });

  it("assigns failures and retry paths to the entity that actually failed", () => {
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: failed<Thought>(),
      article: missing<Article>(),
    })).toMatchObject({
      kind: "error",
      entity: "thought",
      reason: "connection",
      retryEntity: "thought",
    });

    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: missing<Thought>(),
      article: failed<Article>(),
    })).toMatchObject({
      kind: "error",
      entity: "article",
      reason: "connection",
      retryEntity: "article",
    });
  });

  it("does not allow a non-DIVIDING article to enter the dividing editor", () => {
    expect(resolveDetailEntity({
      requestMode: "dividing",
      thought: missing<Thought>(),
      article: success<Article>({ id: "closing-1", status: "CLOSING", content: "마감 글" }),
    })).toMatchObject({
      kind: "error",
      entity: "article",
      reason: "not-dividing",
      retryEntity: "article",
    });
  });

  it("suppresses the not-dividing false positive while the caller's own forward transition is in flight", () => {
    // The review screen optimistically flips its own article's status to
    // "CLOSING" before navigating away; while that self-initiated patch is
    // pending, this must NOT read as "article is gone" (it would otherwise,
    // since it's no longer DIVIDING).
    expect(resolveDetailEntity({
      requestMode: "dividing",
      thought: missing<Thought>(),
      article: success<Article>({ id: "article-1", status: "CLOSING", content: "마감 전환 중" }),
      suppressNotDividingError: true,
    })).toEqual({ kind: "loading", entity: "article" });
  });

  it("keeps reporting not-dividing once suppression is turned back off (transition finished, failed, or the user returned)", () => {
    expect(resolveDetailEntity({
      requestMode: "dividing",
      thought: missing<Thought>(),
      article: success<Article>({ id: "article-1", status: "CLOSING", content: "마감 전환 중" }),
      suppressNotDividingError: false,
    })).toMatchObject({
      kind: "error",
      entity: "article",
      reason: "not-dividing",
      retryEntity: "article",
    });
  });

  it("never lets suppression hide a genuine query failure (deleted/nonexistent article)", () => {
    // Suppression only defuses the caller's own optimistic status patch. A
    // real 404/409/connection failure from the server must still surface,
    // even while the caller believes a transition is in flight.
    expect(resolveDetailEntity({
      requestMode: "dividing",
      thought: missing<Thought>(),
      article: missing<Article>(),
      suppressNotDividingError: true,
    })).toMatchObject({
      kind: "error",
      entity: "article",
      reason: "not-found",
      retryEntity: "article",
    });
  });

  it("reports an expired session distinctly from a missing record", () => {
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: authExpired<Thought>(),
      article: missing<Article>(),
    })).toMatchObject({
      kind: "error",
      entity: "thought",
      reason: "auth",
      retryEntity: "thought",
    });
  });

  it("reports a network failure as a connection problem", () => {
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: networkFailure<Thought>(),
      article: missing<Article>(),
    })).toMatchObject({
      kind: "error",
      entity: "thought",
      reason: "connection",
      retryEntity: "thought",
    });
  });

  it("distinguishes a missing route (server doesn't provide this lookup yet) from a missing record", () => {
    // An unstructured 404 on the thought request itself means the
    // /thoughts/:id route is missing (server/client version skew) — that is
    // terminal on its own and must NOT fall through to the article lookup,
    // whose response (of any shape) is irrelevant to what actually failed.
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: routeUnavailable<Thought>(),
      article: routeUnavailable<Article>(),
    })).toMatchObject({
      kind: "error",
      entity: "thought",
      reason: "not-implemented",
      retryEntity: "thought",
    });
  });

  it("never lets a real article 404 masquerade as the reason when the thought route itself is missing", () => {
    // Deployment-skew scenario: /thoughts/:id doesn't exist yet (unstructured
    // 404), but /articles/:id exists and, for this id, genuinely has nothing
    // (its own structured 404). The final reason must stay "not-implemented"
    // (the real problem — a missing thought route) and must not be
    // overwritten by the article lookup's unrelated "not-found".
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: routeUnavailable<Thought>(),
      article: missing<Article>(),
    })).toMatchObject({
      kind: "error",
      entity: "thought",
      reason: "not-implemented",
      retryEntity: "thought",
    });
  });

  it("still falls back to the article lookup for a structured thought 404 (the id is simply not a thought)", () => {
    expect(resolveDetailEntity({
      requestMode: "thought",
      thought: missing<Thought>(),
      article: missing<Article>(),
    })).toMatchObject({
      kind: "error",
      entity: "article",
      reason: "not-found",
      retryEntity: "article",
    });
  });
});

describe("classifyDetailError", () => {
  it("classifies structured 404s as not-found and unstructured 404s as not-implemented", () => {
    expect(classifyDetailError({ status: 404, data: { error: "gone" } })).toBe("not-found");
    expect(classifyDetailError({ status: 404, data: "Cannot GET /api/x" })).toBe("not-implemented");
    expect(classifyDetailError({ status: 404 })).toBe("not-implemented");
  });

  it("classifies 401/403 as auth", () => {
    expect(classifyDetailError({ status: 401 })).toBe("auth");
    expect(classifyDetailError({ status: 403 })).toBe("auth");
  });

  it("classifies network/timeout/5xx as connection", () => {
    expect(classifyDetailError(new TypeError("Failed to fetch"))).toBe("connection");
    const timeout = new Error("timed out");
    timeout.name = "TimeoutError";
    expect(classifyDetailError(timeout)).toBe("connection");
    expect(classifyDetailError({ status: 503 })).toBe("connection");
  });
});

describe("detail query retry policy", () => {
  it("retries connection failures up to the retry cap", () => {
    const error = { status: 503 };
    expect(shouldRetryDetailQuery(0, error)).toBe(true);
    expect(shouldRetryDetailQuery(1, error)).toBe(true);
    expect(shouldRetryDetailQuery(2, error)).toBe(false);
  });

  it("never retries a not-found, auth, or not-implemented failure", () => {
    expect(shouldRetryDetailQuery(0, { status: 404, data: { error: "gone" } })).toBe(false);
    expect(shouldRetryDetailQuery(0, { status: 401 })).toBe(false);
    expect(shouldRetryDetailQuery(0, { status: 404 })).toBe(false);
  });

  it("keeps retry delay short and capped", () => {
    expect(detailQueryRetryDelayMs(0)).toBeLessThanOrEqual(1500);
    expect(detailQueryRetryDelayMs(5)).toBeLessThanOrEqual(1500);
  });

  it("exposes retryability independent of the retry-count cap", () => {
    expect(isRetryableDetailError({ status: 500 })).toBe(true);
    expect(isRetryableDetailError({ status: 404, data: { error: "gone" } })).toBe(false);
  });
});

describe("isConfirmedGoneError", () => {
  it("confirms only a structured domain 404/409, not any 404/409", () => {
    expect(isConfirmedGoneError({ status: 404, data: { error: "Thought not found" } })).toBe(true);
    expect(isConfirmedGoneError({ status: 409, data: { error: "Thought is not an active queued question" } })).toBe(
      true,
    );
  });

  it("does NOT confirm an unstructured 404/409 (missing/stale route, proxy response) — that must stay retry-capable", () => {
    // This is the exact deployment-skew scenario a naive status-only check
    // would get wrong: the activate route itself doesn't exist yet, so the
    // response is an unmatched-route 404 with no JSON body. Reporting this
    // as "the question is gone" would be false and would strand the user
    // with no way to retry once the server catches up.
    expect(isConfirmedGoneError({ status: 404, data: "Cannot POST /api/thoughts/x/activate" })).toBe(false);
    expect(isConfirmedGoneError({ status: 404 })).toBe(false);
    expect(isConfirmedGoneError({ status: 409, data: "Conflict" })).toBe(false);
  });

  it("does not confirm connection or auth failures", () => {
    expect(isConfirmedGoneError({ status: 500, data: { error: "boom" } })).toBe(false);
    expect(isConfirmedGoneError({ status: 401, data: { error: "Unauthorized" } })).toBe(false);
    expect(isConfirmedGoneError(new TypeError("Network request failed"))).toBe(false);
  });
});
