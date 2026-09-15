import { describe, expect, it, vi } from "vitest";
import { AnalyticsIdentityCoordinator } from "./analyticsIdentity";

function createHarness(
  persistedIdentity: {
    distinctId: string;
    anonymousId: string;
  } | null = {
    distinctId: "anonymous-current",
    anonymousId: "anonymous-current",
  },
) {
  const calls: string[] = [];
  const identify = vi.fn((userId: string) => calls.push(`identify:${userId}`));
  const reset = vi.fn(() => calls.push("reset"));
  return {
    calls,
    identify,
    reset,
    coordinator: new AnalyticsIdentityCoordinator({
      identify,
      reset,
      getIdentity: () => persistedIdentity,
    }),
  };
}

describe("AnalyticsIdentityCoordinator", () => {
  it("identifies a restored authenticated user once", () => {
    const { coordinator, identify, reset } = createHarness();

    coordinator.publishUser(null);
    coordinator.publishUser("user-a");

    expect(identify).toHaveBeenCalledOnce();
    expect(identify).toHaveBeenCalledWith("user-a");
    expect(reset).toHaveBeenCalledOnce();
  });

  it("does not identify again for rerenders or token refreshes", () => {
    const { coordinator, identify, reset } = createHarness();

    coordinator.publishUser("user-a");
    coordinator.publishUser("user-a");
    coordinator.publishUser("user-a");

    expect(identify).toHaveBeenCalledOnce();
    expect(reset).not.toHaveBeenCalled();
  });

  it("clears a persisted user when the first finalized state is logged out", () => {
    const { coordinator, identify, reset } = createHarness({
      distinctId: "user-a",
      anonymousId: "anonymous-before-a",
    });

    coordinator.publishUser(null);

    expect(reset).toHaveBeenCalledOnce();
    expect(identify).not.toHaveBeenCalled();
  });

  it("resets persisted account A before first identifying account B", () => {
    const { coordinator, calls } = createHarness({
      distinctId: "user-a",
      anonymousId: "anonymous-before-a",
    });

    coordinator.publishUser("user-b");

    expect(calls).toEqual(["reset", "identify:user-b"]);
  });

  it("re-identifies the same persisted account without resetting it", () => {
    const { coordinator, calls } = createHarness({
      distinctId: "user-a",
      anonymousId: "anonymous-before-a",
    });

    coordinator.publishUser("user-a");
    coordinator.publishUser("user-a");

    expect(calls).toEqual(["identify:user-a"]);
  });

  it("does not reset a current anonymous identity before first login", () => {
    const { coordinator, calls } = createHarness();

    coordinator.publishUser("user-a");

    expect(calls).toEqual(["identify:user-a"]);
  });

  it("resets before identifying when PostHog has not hydrated its IDs yet", () => {
    const { coordinator, calls } = createHarness({
      distinctId: "",
      anonymousId: "",
    });

    coordinator.publishUser("user-b");

    expect(calls).toEqual(["reset", "identify:user-b"]);
  });

  it("resets on logout and identifies again after relogin", () => {
    const { coordinator, calls } = createHarness();

    coordinator.publishUser("user-a");
    coordinator.publishUser(null);
    coordinator.publishUser(null);
    coordinator.publishUser("user-a");

    expect(calls).toEqual(["identify:user-a", "reset", "identify:user-a"]);
  });

  it("resets the previous user before identifying a different account", () => {
    const { coordinator, calls } = createHarness();

    coordinator.publishUser("user-a");
    coordinator.publishUser("user-b");

    expect(calls).toEqual(["identify:user-a", "reset", "identify:user-b"]);
  });

  it("keeps transitions non-blocking when analytics is disabled or throws", () => {
    const disabled = new AnalyticsIdentityCoordinator({
      identify: () => {},
      reset: () => {},
      getIdentity: () => null,
    });
    expect(() => {
      disabled.publishUser("user-a");
      disabled.publishUser(null);
    }).not.toThrow();

    const failing = new AnalyticsIdentityCoordinator({
      identify: () => {
        throw new Error("identify unavailable");
      },
      reset: () => {
        throw new Error("reset unavailable");
      },
      getIdentity: () => {
        throw new Error("identity unavailable");
      },
    });
    expect(() => {
      failing.publishUser("user-a");
      failing.publishUser("user-b");
      failing.publishUser(null);
    }).not.toThrow();
  });
});