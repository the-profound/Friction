import { describe, expect, it, vi } from "vitest";

import {
  AuthSessionUnavailableError,
  runAuthenticatedMutation,
} from "./authenticatedMutation";

describe("runAuthenticatedMutation", () => {
  it("refreshes a missing token before sending", async () => {
    const refreshSession = vi.fn().mockResolvedValue({ access_token: "fresh" });
    const mutate = vi.fn().mockResolvedValue("sent");

    await expect(
      runAuthenticatedMutation({
        hasUsableToken: () => false,
        refreshSession,
        mutate,
      }),
    ).resolves.toBe("sent");
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(1);
  });

  it("refreshes and retries exactly once after an authentication rejection", async () => {
    const refreshSession = vi.fn().mockResolvedValue({ access_token: "fresh" });
    const mutate = vi
      .fn()
      .mockRejectedValueOnce({ status: 401, data: { code: "AUTH_REQUIRED" } })
      .mockResolvedValueOnce("sent");

    await expect(
      runAuthenticatedMutation({
        hasUsableToken: () => true,
        refreshSession,
        mutate,
      }),
    ).resolves.toBe("sent");
    expect(refreshSession).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(2);
  });

  it("shows an actionable login error when the session cannot be refreshed", async () => {
    const mutate = vi.fn();

    await expect(
      runAuthenticatedMutation({
        hasUsableToken: () => false,
        refreshSession: vi.fn().mockResolvedValue(null),
        mutate,
      }),
    ).rejects.toBeInstanceOf(AuthSessionUnavailableError);
    expect(mutate).not.toHaveBeenCalled();
  });
});