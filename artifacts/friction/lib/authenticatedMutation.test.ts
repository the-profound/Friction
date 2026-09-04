import { describe, expect, it, vi } from "vitest";

import {
  AuthSessionUnavailableError,
  createSubmissionLock,
  runAuthenticatedMutation,
} from "./authenticatedMutation";

describe("runAuthenticatedMutation", () => {
  it("locks fast repeated submissions until the entire attempt finishes", () => {
    const lock = createSubmissionLock();
    expect(lock.tryAcquire()).toBe(true);
    expect(lock.tryAcquire()).toBe(false);
    expect(lock.isLocked()).toBe(true);
    lock.release();
    expect(lock.tryAcquire()).toBe(true);
  });

  it("refreshes a missing token before sending", async () => {
    const prepareSession = vi.fn().mockResolvedValue({ access_token: "fresh" });
    const mutate = vi.fn().mockResolvedValue("sent");

    await expect(
      runAuthenticatedMutation({
        prepareSession,
        mutate,
      }),
    ).resolves.toBe("sent");
    expect(prepareSession).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("always waits for the auth boundary even when a token is already usable", async () => {
    const prepareSession = vi.fn().mockResolvedValue({ access_token: "current" });
    const mutate = vi.fn().mockResolvedValue("sent");

    await expect(
      runAuthenticatedMutation({
        prepareSession,
        mutate,
      }),
    ).resolves.toBe("sent");
    expect(prepareSession).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("does not replay a final 401 after customFetch has exhausted its retry", async () => {
    const prepareSession = vi.fn().mockResolvedValue({ access_token: "current" });
    const mutate = vi.fn().mockRejectedValue({
      status: 401,
      data: { code: "AUTH_REQUIRED" },
    });

    await expect(
      runAuthenticatedMutation({
        prepareSession,
        mutate,
      }),
    ).rejects.toBeInstanceOf(AuthSessionUnavailableError);
    expect(prepareSession).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("shows an actionable login error when the session cannot be refreshed", async () => {
    const mutate = vi.fn();

    await expect(
      runAuthenticatedMutation({
        prepareSession: vi.fn().mockResolvedValue(null),
        mutate,
      }),
    ).rejects.toBeInstanceOf(AuthSessionUnavailableError);
    expect(mutate).not.toHaveBeenCalled();
  });
});