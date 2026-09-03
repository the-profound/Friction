export interface AuthFailureLike {
  status?: number;
  data?: unknown;
}

function authFailureCode(error: AuthFailureLike): string | null {
  if (!error.data || typeof error.data !== "object") return null;
  const code = (error.data as { code?: unknown }).code;
  return typeof code === "string" ? code : null;
}

export function isAuthenticationFailure(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const candidate = error as AuthFailureLike;
  const code = authFailureCode(candidate);
  return (
    candidate.status === 401 ||
    code === "AUTH_REQUIRED" ||
    code === "AUTH_INVALID"
  );
}

export class AuthSessionUnavailableError extends Error {
  readonly name = "AuthSessionUnavailableError";

  constructor() {
    super("로그인 상태를 확인할 수 없어요. 다시 로그인한 뒤 시도해주세요.");
  }
}

export async function runAuthenticatedMutation<T>({
  hasUsableToken,
  refreshSession,
  mutate,
}: {
  hasUsableToken: () => boolean;
  refreshSession: () => Promise<unknown | null>;
  mutate: () => Promise<T>;
}): Promise<T> {
  if (!hasUsableToken() && !(await refreshSession())) {
    throw new AuthSessionUnavailableError();
  }

  try {
    return await mutate();
  } catch (error) {
    if (!isAuthenticationFailure(error)) throw error;
  }

  if (!(await refreshSession())) {
    throw new AuthSessionUnavailableError();
  }

  try {
    return await mutate();
  } catch (error) {
    if (isAuthenticationFailure(error)) {
      throw new AuthSessionUnavailableError();
    }
    throw error;
  }
}