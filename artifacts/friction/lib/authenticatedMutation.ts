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

export function createSubmissionLock() {
  let locked = false;
  return {
    tryAcquire(): boolean {
      if (locked) return false;
      locked = true;
      return true;
    },
    release(): void {
      locked = false;
    },
    isLocked(): boolean {
      return locked;
    },
  };
}

export async function runAuthenticatedMutation<T>({
  prepareSession,
  mutate,
}: {
  prepareSession: () => Promise<unknown | null>;
  mutate: () => Promise<T>;
}): Promise<T> {
  // Always cross the restore/foreground boundary, even when the in-memory
  // token still appears valid. AppState may not yet reflect the foreground
  // transition that allowed the user to press the button.
  if (!(await prepareSession())) {
    throw new AuthSessionUnavailableError();
  }

  try {
    return await mutate();
  } catch (error) {
    if (!isAuthenticationFailure(error)) throw error;
    // customFetch owns the single 401 refresh + replay. A 401 reaching this
    // layer is therefore permanent for this attempt; never issue it again.
    throw new AuthSessionUnavailableError();
  }
}