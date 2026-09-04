import { describe, expect, it } from "vitest";
import {
  GuardedReturnSession,
  createReturnStack,
  popReturnStack,
  replaceReturnStack,
} from "../guardedReturnSession";

describe("GuardedReturnSession", () => {
  it("replays one completed iOS or browser removal after a delayed snapshot without re-exposing the editor", async () => {
    const stack = createReturnStack(["(tabs)", "on-01a"]);
    stack.visibleHistory = ["(tabs)", "on-01a"];
    const session = new GuardedReturnSession<"POP">();
    let releaseSnapshot!: () => void;
    const snapshotHandoff = new Promise<void>((resolve) => {
      releaseSnapshot = resolve;
    });

    expect(session.begin()).toBe(true);
    expect(session.begin()).toBe(false);
    expect(stack.visibleHistory).toEqual(["(tabs)", "on-01a"]);

    const exit = snapshotHandoff.then(() =>
      session.commitIntercepted("POP", () => popReturnStack(stack)));
    expect(stack.dispatchCount).toBe(0);
    releaseSnapshot();
    expect(await exit).toBe(true);
    expect(session.commitIntercepted("POP", () => popReturnStack(stack))).toBe(false);

    expect(stack.dispatchCount).toBe(1);
    expect(stack.routes).toEqual(["(tabs)"]);
    expect(stack.visibleHistory).toEqual(["(tabs)", "on-01a", "(tabs)"]);
    expect(stack.visibleHistory.slice(2)).not.toContain("on-01a");
  });

  it("does not start an exit for a cancelled edge gesture", () => {
    const stack = createReturnStack(["(tabs)", "on-01a"]);
    const session = new GuardedReturnSession<"POP">();

    // usePreventRemove has no callback for a gesture that returns to its origin.
    expect(stack.dispatchCount).toBe(0);
    expect(stack.routes).toEqual(["(tabs)", "on-01a"]);
    expect(stack.visibleHistory).toEqual(["on-01a"]);
    expect(session.begin()).toBe(true);
  });

  it("lets a failed export retry but still commits only one later removal", () => {
    const stack = createReturnStack(["(tabs)", "on-01a"]);
    const session = new GuardedReturnSession<"POP">();

    expect(session.begin()).toBe(true);
    session.retry();
    expect(session.begin()).toBe(true);
    expect(session.commitIntercepted("POP", () => popReturnStack(stack))).toBe(true);
    expect(session.begin()).toBe(false);
    expect(stack.dispatchCount).toBe(1);
  });

  it("commits header and Android exits once after the guard is removed", () => {
    const stack = createReturnStack(["(tabs)", "on-01a"]);
    const session = new GuardedReturnSession<never>();

    expect(session.begin()).toBe(true);
    const generation = session.prepareExplicit(() => popReturnStack(stack));
    expect(generation).not.toBeNull();
    expect(session.prepareExplicit(() => popReturnStack(stack))).toBeNull();
    expect(session.consumeExplicit(generation!)).toBe(true);
    expect(session.consumeExplicit(generation!)).toBe(false);

    expect(stack.dispatchCount).toBe(1);
    expect(stack.routes).toEqual(["(tabs)"]);
    expect(stack.visibleHistory).toEqual(["on-01a", "(tabs)"]);
  });

  it("replaces direct, recovery, and quote entries with their safe list without exposing the prior route", () => {
    for (const [sourceRoute, destination] of [
      ["read", "(tabs)"],
      ["recovery", "(tabs)"],
      ["quote-detail", "archive"],
    ] as const) {
      const stack = createReturnStack([sourceRoute, "on-01a"]);
      const session = new GuardedReturnSession<"POP">();
      expect(session.begin()).toBe(true);
      const generation = session.prepareExplicit(() => replaceReturnStack(stack, destination));
      expect(session.consumeExplicit(generation!)).toBe(true);
      expect(stack.dispatchCount).toBe(1);
      expect(stack.routes).toEqual([sourceRoute, destination]);
      expect(stack.visibleHistory).toEqual(["on-01a", destination]);
    }
  });

  it("invalidates a scheduled exit on unmount or entity-stage replacement", () => {
    const stack = createReturnStack(["(tabs)", "on-01a"]);
    const session = new GuardedReturnSession<never>();
    expect(session.begin()).toBe(true);
    const generation = session.prepareExplicit(() => popReturnStack(stack));

    session.dispose();
    expect(session.consumeExplicit(generation!)).toBe(false);
    expect(stack.dispatchCount).toBe(0);
    expect(stack.routes).toEqual(["(tabs)", "on-01a"]);
  });

  it("opens a fresh guarded exit session after an in-place stage or entity route replacement", () => {
    const stack = createReturnStack(["(tabs)", "on-01a"]);
    const session = new GuardedReturnSession<never>();

    const replacement = session.prepareExplicit(() => replaceReturnStack(stack, "on-01a"));
    expect(session.consumeExplicit(replacement!)).toBe(true);
    expect(session.resetAfterRouteChange()).toBe(true);
    expect(session.begin()).toBe(true);

    const exit = session.prepareExplicit(() => popReturnStack(stack));
    expect(session.consumeExplicit(exit!)).toBe(true);
    expect(stack.dispatchCount).toBe(2);
    expect(stack.routes).toEqual(["(tabs)"]);
  });
});