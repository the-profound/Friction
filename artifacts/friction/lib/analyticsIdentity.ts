export interface AnalyticsIdentityActions {
  identify: (userId: string) => void;
  reset: () => void;
  getIdentity: () => {
    distinctId: string;
    anonymousId: string;
  } | null;
}

export class AnalyticsIdentityCoordinator {
  private initialized = false;
  private identifiedUserId: string | null = null;

  constructor(private readonly actions: AnalyticsIdentityActions) {}

  publishUser(userId: string | null): void {
    if (!this.initialized) {
      this.initialized = true;
      const persistedIdentity = this.getPersistedIdentity();

      if (userId === null) {
        // A finalized logged-out state starts a fresh anonymous identity. This
        // clears any identified user retained by PostHog from an earlier launch.
        this.runSafely(this.actions.reset);
        return;
      }

      const persistedUserId =
        persistedIdentity &&
        persistedIdentity.distinctId !== persistedIdentity.anonymousId
          ? persistedIdentity.distinctId
          : null;
      if (persistedUserId !== null && persistedUserId !== userId) {
        this.runSafely(this.actions.reset);
      } else if (persistedIdentity === null) {
        // If persisted state cannot be inspected, prefer isolation over
        // potentially merging a previous account into this one.
        this.runSafely(this.actions.reset);
      }
      this.runSafely(() => this.actions.identify(userId));
      this.identifiedUserId = userId;
      return;
    }

    if (userId === this.identifiedUserId) return;

    if (this.identifiedUserId !== null) {
      this.runSafely(this.actions.reset);
      this.identifiedUserId = null;
    }

    if (userId !== null) {
      this.runSafely(() => this.actions.identify(userId));
      this.identifiedUserId = userId;
    }
  }

  private runSafely(operation: () => void): void {
    try {
      operation();
    } catch {
      // Authentication remains authoritative if analytics is unavailable.
    }
  }

  private getPersistedIdentity(): ReturnType<AnalyticsIdentityActions["getIdentity"]> {
    try {
      const identity = this.actions.getIdentity();
      if (!identity?.distinctId || !identity.anonymousId) return null;
      return identity;
    } catch {
      return null;
    }
  }
}