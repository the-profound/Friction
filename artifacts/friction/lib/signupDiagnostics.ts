export const SIGNUP_DIAGNOSTIC_CODES = [
  "SIGNUP_AUTH_SERVICE",
  "SIGNUP_NETWORK",
  "SIGNUP_API_UNREACHABLE",
  "SYNC_AUTH_INVALID",
  "SYNC_AUTH_UNAVAILABLE",
  "SYNC_DATABASE_UNAVAILABLE",
  "SYNC_EMAIL_CONFLICT",
  "SYNC_IDENTITY_MISMATCH",
  "SYNC_INVALID_REQUEST",
  "SYNC_UNKNOWN",
  "AUTH_TRANSITION_ERROR",
  "SIGNUP_UNKNOWN",
] as const;

export type SignupDiagnosticCode = (typeof SIGNUP_DIAGNOSTIC_CODES)[number];

export interface SignupFailure {
  code: SignupDiagnosticCode;
  diagnosticId: string;
  message: string;
}

export function getSignupFailureAlertContent(failure: SignupFailure): {
  title: string;
  message: string;
} {
  return {
    title: "회원가입에 실패했어요",
    message: `${failure.message}\n\n오류 코드: ${failure.code}\n진단 번호: ${failure.diagnosticId}`,
  };
}

/**
 * Returns the already-sanitized message for the active signup form.
 * Keep the inline message separate from the diagnostic details shown in the
 * native alert so the form remains useful after the alert is dismissed.
 */
export function getSignupFailureInlineMessage(failure: SignupFailure): string {
  return failure.message;
}

function errorText(error: unknown): string {
  if (typeof error !== "object" || error === null) return String(error).toLowerCase();
  const candidate = error as { message?: unknown };
  return typeof candidate.message === "string" ? candidate.message.toLowerCase() : "";
}

export function isNetworkFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) {
    const message = String(error).toLowerCase();
    return (
      message.includes("network") ||
      message.includes("fetch") ||
      message.includes("timeout") ||
      message.includes("abort")
    );
  }

  const candidate = error as { name?: unknown; message?: unknown; status?: unknown };
  const name = typeof candidate.name === "string" ? candidate.name.toLowerCase() : "";
  const message = errorText(error);
  const status = typeof candidate.status === "number" ? candidate.status : null;
  // A nonzero HTTP status proves that the request reached a service, even if
  // its response body happens to contain transport-looking words.
  if (status !== null) return status === 0;

  return (
    name.includes("network") ||
    name.includes("fetch") ||
    name.includes("abort") ||
    name.includes("timeout") ||
    message.includes("network") ||
    message.includes("fetch") ||
    message.includes("timeout") ||
    message.includes("abort")
  );
}

function getServerSyncCode(error: unknown): SignupDiagnosticCode | null {
  if (typeof error !== "object" || error === null) return null;

  const candidate = error as {
    name?: unknown;
    data?: { code?: unknown } | null;
  };
  const code =
    typeof candidate.data?.code === "string"
      ? candidate.data.code
      : typeof candidate.name === "string"
        ? candidate.name
        : null;
  if (!code) return null;

  switch (code) {
    case "AUTH_REQUIRED":
    case "AUTH_INVALID":
      return "SYNC_AUTH_INVALID";
    case "AUTH_UNAVAILABLE":
      return "SYNC_AUTH_UNAVAILABLE";
    default:
      return SIGNUP_DIAGNOSTIC_CODES.includes(code as SignupDiagnosticCode) &&
        code.startsWith("SYNC_")
        ? (code as SignupDiagnosticCode)
        : null;
  }
}

function failure(
  code: SignupDiagnosticCode,
  diagnosticId: string,
  message: string,
): SignupFailure {
  return { code, diagnosticId, message };
}

/**
 * Converts an upstream Supabase response or thrown request error into a small,
 * display-safe result. It intentionally inspects only enough detail to retain
 * existing user guidance and never returns the upstream text.
 */
export function getSignupAuthFailure(
  error: unknown,
  diagnosticId: string,
): SignupFailure {
  if (isNetworkFailure(error)) {
    return failure(
      "SIGNUP_NETWORK",
      diagnosticId,
      "인증 서비스에 연결하지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도해주세요.",
    );
  }

  const message = errorText(error);
  if (
    message.includes("already registered") ||
    message.includes("already exists") ||
    message.includes("user already")
  ) {
    return failure(
      "SIGNUP_AUTH_SERVICE",
      diagnosticId,
      "이미 가입된 이메일입니다. 로그인해주세요.",
    );
  }
  if (message.includes("password")) {
    return failure(
      "SIGNUP_AUTH_SERVICE",
      diagnosticId,
      "비밀번호는 6자 이상이어야 합니다.",
    );
  }

  return failure(
    "SIGNUP_AUTH_SERVICE",
    diagnosticId,
    "인증 서비스에서 가입을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
  );
}

/**
 * Classifies the post-auth profile request without retaining its response body
 * or exception message. Stable API response codes are preserved verbatim.
 */
export function getSignupProfileSyncFailure(
  error: unknown,
  diagnosticId: string,
): SignupFailure {
  const code = getSignupProfileSyncCode(error);
  if (code !== "SIGNUP_API_UNREACHABLE" && code !== "SYNC_UNKNOWN") {
    const message =
      code === "SYNC_AUTH_INVALID"
        ? "계정 인증 상태를 확인하지 못했습니다. 로그인 화면에서 다시 시도해주세요."
        : code === "SYNC_EMAIL_CONFLICT"
          ? "계정 정보를 저장하지 못했습니다. 로그인 화면에서 다시 시도해주세요."
          : "계정은 생성됐지만 프로필 저장을 완료하지 못했습니다. 로그인 화면에서 다시 시도해주세요.";
    return failure(code, diagnosticId, message);
  }

  if (code === "SIGNUP_API_UNREACHABLE") {
    return failure(
      "SIGNUP_API_UNREACHABLE",
      diagnosticId,
      "계정은 생성됐지만 앱 서버에 연결하지 못했습니다. 연결을 확인한 뒤 로그인 화면에서 다시 시도해주세요.",
    );
  }

  return failure(
    "SYNC_UNKNOWN",
    diagnosticId,
    "계정은 생성됐지만 프로필 저장을 완료하지 못했습니다. 로그인 화면에서 다시 시도해주세요.",
  );
}

export function getSignupProfileSyncCode(error: unknown): SignupDiagnosticCode {
  return getServerSyncCode(error) ??
    (isNetworkFailure(error) ? "SIGNUP_API_UNREACHABLE" : "SYNC_UNKNOWN");
}

export function getSignupTransitionFailure(diagnosticId: string): SignupFailure {
  return failure(
    "AUTH_TRANSITION_ERROR",
    diagnosticId,
    "가입 상태를 확정하지 못했습니다. 다시 시도해주세요.",
  );
}

export function getUnknownSignupFailure(diagnosticId: string): SignupFailure {
  return failure(
    "SIGNUP_UNKNOWN",
    diagnosticId,
    "회원가입을 완료하지 못했습니다. 잠시 후 다시 시도해주세요.",
  );
}