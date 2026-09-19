import { describe, expect, it, vi } from "vitest";
import {
  launchCompletionAction,
  type CompletionActionLock,
} from "./completionActionCoordinator";

function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("launchCompletionAction", () => {
  it("applies the immediate effect before delayed persistence settles", async () => {
    const lock: CompletionActionLock = { current: null };
    const pending = deferred<void>();
    const events: string[] = [];

    const started = launchCompletionAction({
      lock,
      action: "reply",
      onStart: () => events.push("navigate"),
      work: async () => {
        events.push("persist");
        await pending.promise;
      },
      onError: () => events.push("error"),
      onFinally: () => events.push("settled"),
    });

    expect(started).toBe(true);
    expect(events).toEqual(["navigate"]);
    expect(lock.current).toBe("reply");
    await Promise.resolve();
    expect(events).toEqual(["navigate", "persist"]);

    pending.resolve();
    await pending.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(events).toEqual(["navigate", "persist", "settled"]);
    expect(lock.current).toBeNull();
  });

  it("blocks rapid duplicate and competing actions until the first settles", async () => {
    const lock: CompletionActionLock = { current: null };
    const pending = deferred<void>();
    const work = vi.fn(() => pending.promise);

    expect(launchCompletionAction({
      lock,
      action: "save",
      onStart: vi.fn(),
      work,
      onError: vi.fn(),
      onFinally: vi.fn(),
    })).toBe(true);
    expect(launchCompletionAction({
      lock,
      action: "reply",
      onStart: vi.fn(),
      work,
      onError: vi.fn(),
      onFinally: vi.fn(),
    })).toBe(false);

    await Promise.resolve();
    expect(work).toHaveBeenCalledTimes(1);
    pending.resolve();
    await pending.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(lock.current).toBeNull();
  });

  it("reports failure and releases the action for an in-screen retry", async () => {
    const lock: CompletionActionLock = { current: null };
    const onSuccess = vi.fn();
    const onError = vi.fn();
    const onFinally = vi.fn();

    expect(launchCompletionAction({
      lock,
      action: "save",
      onStart: vi.fn(),
      work: async () => {
        throw new Error("archive failed");
      },
      onSuccess,
      onError,
      onFinally,
    })).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onError).toHaveBeenCalledWith(expect.objectContaining({ message: "archive failed" }));
    expect(onSuccess).not.toHaveBeenCalled();
    expect(onFinally).toHaveBeenCalledTimes(1);
    expect(lock.current).toBeNull();
  });

  it("runs success cleanup only after required background work succeeds", async () => {
    const lock: CompletionActionLock = { current: null };
    const pending = deferred<void>();
    const clearRecoverableSession = vi.fn();

    launchCompletionAction({
      lock,
      action: "reply",
      onStart: vi.fn(),
      work: () => pending.promise,
      onSuccess: clearRecoverableSession,
      onError: vi.fn(),
      onFinally: vi.fn(),
    });

    await Promise.resolve();
    expect(clearRecoverableSession).not.toHaveBeenCalled();
    pending.resolve();
    await pending.promise;
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(clearRecoverableSession).toHaveBeenCalledTimes(1);
  });
});