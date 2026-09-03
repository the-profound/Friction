export type CustomFetchOptions = RequestInit & {
  responseType?: "json" | "text" | "blob" | "auto";
};

export type ApiRequestTelemetry = {
  requestId: string;
  method: string;
  route: string;
  outcome: "success" | "http_error" | "network_error" | "timeout";
  durationMs: number;
  statusCode?: number;
  failureType?: "http_4xx" | "http_5xx" | "network" | "timeout";
};

export type ApiRequestTelemetryObserver = (event: ApiRequestTelemetry) => void;

// ---------------------------------------------------------------------------
// Default request timeout
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 15_000;

/**
 * Returns an AbortSignal that fires after `ms` milliseconds.
 * Uses `AbortSignal.timeout` when available (Node 17.3+, modern browsers),
 * otherwise falls back to a manual AbortController + setTimeout.
 */
function buildTimeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(ms);
  }
  const controller = new AbortController();
  setTimeout(
    () =>
      controller.abort(
        new DOMException("The operation was aborted due to timeout", "TimeoutError"),
      ),
    ms,
  );
  return controller.signal;
}

/**
 * Returns an AbortSignal that aborts as soon as either `a` or `b` aborts.
 * Uses `AbortSignal.any` when available; otherwise wires up manual listeners.
 */
function combineSignals(a: AbortSignal, b: AbortSignal): AbortSignal {
  if (typeof (AbortSignal as unknown as { any?: unknown }).any === "function") {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (AbortSignal as any).any([a, b]);
  }
  const controller = new AbortController();
  const onAbort = function (this: AbortSignal) {
    controller.abort(this.reason);
  };
  if (a.aborted) {
    controller.abort(a.reason);
    return controller.signal;
  }
  if (b.aborted) {
    controller.abort(b.reason);
    return controller.signal;
  }
  a.addEventListener("abort", onAbort, { once: true });
  b.addEventListener("abort", onAbort, { once: true });
  return controller.signal;
}

export type ErrorType<T = unknown> = ApiError<T>;

export type BodyType<T> = T;

export type AuthTokenGetter = () => Promise<string | null> | string | null;

const NO_BODY_STATUS = new Set([204, 205, 304]);
const DEFAULT_JSON_ACCEPT = "application/json, application/problem+json";

// ---------------------------------------------------------------------------
// Module-level configuration
// ---------------------------------------------------------------------------

let _baseUrl: string | null = null;
let _authTokenGetter: AuthTokenGetter | null = null;
let _requestTelemetryObserver: ApiRequestTelemetryObserver | null = null;
let _lastRequestId: string | null = null;

export function setRequestTelemetryObserver(
  observer: ApiRequestTelemetryObserver | null,
): void {
  _requestTelemetryObserver = observer;
}

export function getLastRequestId(): string | null {
  return _lastRequestId;
}

function createRequestId(): string {
  const randomPart = Math.random().toString(36).slice(2, 14).padEnd(12, "0");
  return `req_${Date.now().toString(36)}${randomPart}`;
}

function safeRoute(input: RequestInfo | URL): string {
  const raw = resolveUrl(input);
  try {
    const path = raw.startsWith("/") ? raw : new URL(raw).pathname;
    return path
      .split("?", 1)[0]
      .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, ":id")
      .replace(/\/\d+(?=\/|$)/g, "/:id");
  } catch {
    return "unknown";
  }
}

function emitRequestTelemetry(event: ApiRequestTelemetry): void {
  try {
    _requestTelemetryObserver?.(event);
  } catch {
    // Operational telemetry must never alter API behavior.
  }
}

/**
 * Set a base URL that is prepended to every relative request URL
 * (i.e. paths that start with `/`).
 *
 * Useful for Expo bundles that need to call a remote API server.
 * Pass `null` to clear the base URL.
 */
export function setBaseUrl(url: string | null): void {
  _baseUrl = url ? url.replace(/\/+$/, "") : null;
}

/**
 * Register a getter that supplies a bearer auth token.  Before every fetch
 * the getter is invoked; when it returns a non-null string, an
 * `Authorization: Bearer <token>` header is attached to the request.
 *
 * Useful for Expo bundles making token-gated API calls.
 * Pass `null` to clear the getter.
 */
export function setAuthTokenGetter(getter: AuthTokenGetter | null): void {
  _authTokenGetter = getter;
}

export type AuthRefreshCallback = () => Promise<string | null>;
let _authRefreshCallback: AuthRefreshCallback | null = null;

/**
 * Register a callback that is invoked when a request returns 401.
 * The callback should refresh the auth session and return the new access token,
 * or null if the refresh failed. The original request is then retried once
 * with the new token. Pass null to clear (disables auto-retry).
 */
export function setAuthRefreshCallback(callback: AuthRefreshCallback | null): void {
  _authRefreshCallback = callback;
}

function isRequest(input: RequestInfo | URL): input is Request {
  return typeof Request !== "undefined" && input instanceof Request;
}

function resolveMethod(input: RequestInfo | URL, explicitMethod?: string): string {
  if (explicitMethod) return explicitMethod.toUpperCase();
  if (isRequest(input)) return input.method.toUpperCase();
  return "GET";
}

// Use loose check for URL — some runtimes (e.g. React Native) polyfill URL
// differently, so `instanceof URL` can fail.
function isUrl(input: RequestInfo | URL): input is URL {
  return typeof URL !== "undefined" && input instanceof URL;
}

function applyBaseUrl(input: RequestInfo | URL): RequestInfo | URL {
  if (!_baseUrl) return input;
  const url = resolveUrl(input);
  // Only prepend to relative paths (starting with /)
  if (!url.startsWith("/")) return input;

  const absolute = `${_baseUrl}${url}`;
  if (typeof input === "string") return absolute;
  if (isUrl(input)) return new URL(absolute);
  return new Request(absolute, input as Request);
}

function resolveUrl(input: RequestInfo | URL): string {
  if (typeof input === "string") return input;
  if (isUrl(input)) return input.toString();
  return input.url;
}

function isReactNativeRuntime(): boolean {
  return (
    typeof navigator !== "undefined" &&
    (navigator as Navigator & { product?: string }).product === "ReactNative"
  );
}

function mergeHeaders(...sources: Array<HeadersInit | undefined>): Headers {
  const headers = new Headers();

  for (const source of sources) {
    if (!source) continue;
    new Headers(source).forEach((value, key) => {
      headers.set(key, value);
    });
  }

  return headers;
}

function getMediaType(headers: Headers): string | null {
  const value = headers.get("content-type");
  return value ? value.split(";", 1)[0].trim().toLowerCase() : null;
}

function isJsonMediaType(mediaType: string | null): boolean {
  return mediaType === "application/json" || Boolean(mediaType?.endsWith("+json"));
}

function isTextMediaType(mediaType: string | null): boolean {
  return Boolean(
    mediaType &&
      (mediaType.startsWith("text/") ||
        mediaType === "application/xml" ||
        mediaType === "text/xml" ||
        mediaType.endsWith("+xml") ||
        mediaType === "application/x-www-form-urlencoded"),
  );
}

// Use strict equality: in browsers, `response.body` is `null` when the
// response genuinely has no content.  In React Native, `response.body` is
// always `undefined` because the ReadableStream API is not implemented —
// even when the response carries a full payload readable via `.text()` or
// `.json()`.  Loose equality (`== null`) matches both `null` and `undefined`,
// which causes every React Native response to be treated as empty.
function hasNoBody(response: Response, method: string): boolean {
  if (method === "HEAD") return true;
  if (NO_BODY_STATUS.has(response.status)) return true;
  if (response.headers.get("content-length") === "0") return true;
  if (response.body === null) return true;
  return false;
}

function stripBom(text: string): string {
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function looksLikeJson(text: string): boolean {
  const trimmed = text.trimStart();
  return trimmed.startsWith("{") || trimmed.startsWith("[");
}

function getStringField(value: unknown, key: string): string | undefined {
  if (!value || typeof value !== "object") return undefined;

  const candidate = (value as Record<string, unknown>)[key];
  if (typeof candidate !== "string") return undefined;

  const trimmed = candidate.trim();
  return trimmed === "" ? undefined : trimmed;
}

function truncate(text: string, maxLength = 300): string {
  return text.length > maxLength ? `${text.slice(0, maxLength - 1)}…` : text;
}

function buildErrorMessage(response: Response, data: unknown): string {
  const prefix = `HTTP ${response.status} ${response.statusText}`;

  if (typeof data === "string") {
    const text = data.trim();
    return text ? `${prefix}: ${truncate(text)}` : prefix;
  }

  const title = getStringField(data, "title");
  const detail = getStringField(data, "detail");
  const message =
    getStringField(data, "message") ??
    getStringField(data, "error_description") ??
    getStringField(data, "error");

  if (title && detail) return `${prefix}: ${title} — ${detail}`;
  if (detail) return `${prefix}: ${detail}`;
  if (message) return `${prefix}: ${message}`;
  if (title) return `${prefix}: ${title}`;

  return prefix;
}

export class ApiError<T = unknown> extends Error {
  readonly name = "ApiError";
  readonly status: number;
  readonly statusText: string;
  readonly data: T | null;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly requestId: string | null;

  constructor(
    response: Response,
    data: T | null,
    requestInfo: { method: string; url: string },
  ) {
    super(buildErrorMessage(response, data));
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.data = data;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.requestId = response.headers.get("x-request-id");
  }
}

export class ResponseParseError extends Error {
  readonly name = "ResponseParseError";
  readonly status: number;
  readonly statusText: string;
  readonly headers: Headers;
  readonly response: Response;
  readonly method: string;
  readonly url: string;
  readonly rawBody: string;
  readonly cause: unknown;

  constructor(
    response: Response,
    rawBody: string,
    cause: unknown,
    requestInfo: { method: string; url: string },
  ) {
    super(
      `Failed to parse response from ${requestInfo.method} ${response.url || requestInfo.url} ` +
        `(${response.status} ${response.statusText}) as JSON`,
    );
    Object.setPrototypeOf(this, new.target.prototype);

    this.status = response.status;
    this.statusText = response.statusText;
    this.headers = response.headers;
    this.response = response;
    this.method = requestInfo.method;
    this.url = response.url || requestInfo.url;
    this.rawBody = rawBody;
    this.cause = cause;
  }
}

async function parseJsonBody(
  response: Response,
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  const raw = await response.text();
  const normalized = stripBom(raw);

  if (normalized.trim() === "") {
    return null;
  }

  try {
    return JSON.parse(normalized);
  } catch (cause) {
    throw new ResponseParseError(response, raw, cause, requestInfo);
  }
}

async function parseErrorBody(response: Response, method: string): Promise<unknown> {
  if (hasNoBody(response, method)) {
    return null;
  }

  const mediaType = getMediaType(response.headers);

  // Fall back to text when blob() is unavailable (e.g. some React Native builds).
  if (mediaType && !isJsonMediaType(mediaType) && !isTextMediaType(mediaType)) {
    return typeof response.blob === "function" ? response.blob() : response.text();
  }

  const raw = await response.text();
  const normalized = stripBom(raw);
  const trimmed = normalized.trim();

  if (trimmed === "") {
    return null;
  }

  if (isJsonMediaType(mediaType) || looksLikeJson(normalized)) {
    try {
      return JSON.parse(normalized);
    } catch {
      return raw;
    }
  }

  return raw;
}

function inferResponseType(response: Response): "json" | "text" | "blob" {
  const mediaType = getMediaType(response.headers);

  if (isJsonMediaType(mediaType)) return "json";
  if (isTextMediaType(mediaType) || mediaType == null) return "text";
  return "blob";
}

async function parseSuccessBody(
  response: Response,
  responseType: "json" | "text" | "blob" | "auto",
  requestInfo: { method: string; url: string },
): Promise<unknown> {
  if (hasNoBody(response, requestInfo.method)) {
    return null;
  }

  const effectiveType =
    responseType === "auto" ? inferResponseType(response) : responseType;

  switch (effectiveType) {
    case "json":
      return parseJsonBody(response, requestInfo);

    case "text": {
      const text = await response.text();
      return text === "" ? null : text;
    }

    case "blob":
      if (typeof response.blob !== "function") {
        throw new TypeError(
          "Blob responses are not supported in this runtime. " +
            "Use responseType \"json\" or \"text\" instead.",
        );
      }
      return response.blob();
  }
}

export async function customFetch<T = unknown>(
  input: RequestInfo | URL,
  options: CustomFetchOptions = {},
): Promise<T> {
  input = applyBaseUrl(input);
  if (
    isReactNativeRuntime() &&
    !_baseUrl &&
    resolveUrl(input).startsWith("/")
  ) {
    throw new Error(
      "API base URL is not configured for the native release bundle.",
    );
  }
  const { responseType = "auto", headers: headersInit, ...init } = options;

  const method = resolveMethod(input, init.method);

  if (init.body != null && (method === "GET" || method === "HEAD")) {
    throw new TypeError(`customFetch: ${method} requests cannot have a body.`);
  }

  const headers = mergeHeaders(isRequest(input) ? input.headers : undefined, headersInit);
  const hasExplicitAuthorization = headers.has("authorization");
  const requestId = headers.get("x-request-id") ?? createRequestId();
  headers.set("x-request-id", requestId);
  _lastRequestId = requestId;
  (globalThis as typeof globalThis & { __frictionLastRequestId?: string })
    .__frictionLastRequestId = requestId;

  if (
    typeof init.body === "string" &&
    !headers.has("content-type") &&
    looksLikeJson(init.body)
  ) {
    headers.set("content-type", "application/json");
  }

  if (responseType === "json" && !headers.has("accept")) {
    headers.set("accept", DEFAULT_JSON_ACCEPT);
  }

  // Attach bearer token when an auth getter is configured and no
  // Authorization header has been explicitly provided.
  if (_authTokenGetter && !headers.has("authorization")) {
    const token = await _authTokenGetter();
    if (token) {
      headers.set("authorization", `Bearer ${token}`);
    }
  }

  const requestInfo = { method, url: resolveUrl(input) };
  const route = safeRoute(input);
  const startedAt = Date.now();

  // Inject a default 15-second timeout when the caller hasn't supplied one.
  // If the caller did supply a signal, race both so whichever fires first wins.
  const timeoutSignal = buildTimeoutSignal(DEFAULT_TIMEOUT_MS);
  const effectiveSignal = init.signal
    ? combineSignals(init.signal, timeoutSignal)
    : timeoutSignal;

  let response: Response;
  try {
    response = await fetch(input, { ...init, method, headers, signal: effectiveSignal });
  } catch (error) {
    const isTimeout =
      effectiveSignal.aborted ||
      (error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError"));
    emitRequestTelemetry({
      requestId,
      method,
      route,
      outcome: isTimeout ? "timeout" : "network_error",
      durationMs: Date.now() - startedAt,
      failureType: isTimeout ? "timeout" : "network",
    });
    throw error;
  }

  // 401 auto-retry: attempt a single token refresh and re-issue the request.
  // This silently recovers when the access token expired within the near-expiry
  // margin and the API client sent no Authorization header. Retried at most once
  // to prevent infinite loops.
  if (
    !response.ok &&
    response.status === 401 &&
    _authRefreshCallback &&
    !hasExplicitAuthorization
  ) {
    try {
      const newToken = await _authRefreshCallback();
      if (newToken) {
        headers.set("authorization", `Bearer ${newToken}`);
        const retryResponse = await fetch(input, {
          ...init,
          method,
          headers,
          signal: effectiveSignal,
        });
        response = retryResponse;
      }
    } catch {
      // Refresh or network failure on retry — fall through to original error.
    }
  }

  if (!response.ok) {
    emitRequestTelemetry({
      requestId: response.headers.get("x-request-id") ?? requestId,
      method,
      route,
      outcome: "http_error",
      durationMs: Date.now() - startedAt,
      statusCode: response.status,
      failureType: response.status >= 500 ? "http_5xx" : "http_4xx",
    });
    const errorData = await parseErrorBody(response, method);
    throw new ApiError(response, errorData, requestInfo);
  }

  const result = (await parseSuccessBody(response, responseType, requestInfo)) as T;
  emitRequestTelemetry({
    requestId: response.headers.get("x-request-id") ?? requestId,
    method,
    route,
    outcome: "success",
    durationMs: Date.now() - startedAt,
    statusCode: response.status,
  });
  return result;
}
