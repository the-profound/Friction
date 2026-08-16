import {
  isAccessTokenUsable,
  type SessionLike,
} from "./authSessionRecovery";

let currentSession: SessionLike | null = null;

/**
 * The API client must use the session that AuthProvider has already restored
 * and validated. Reading SecureStore through Supabase for every request can
 * race native lifecycle handling and exposes an expired persisted token.
 */
export function setCurrentAuthSession(session: SessionLike | null): void {
  currentSession = session;
}

export function getCurrentAuthAccessToken(now = Date.now()): string | null {
  return isAccessTokenUsable(currentSession, now)
    ? currentSession.access_token
    : null;
}