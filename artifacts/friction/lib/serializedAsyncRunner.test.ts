import { describe, expect, it, vi } from "vitest";
import {
  createLatestAsyncRunner,
  createSerializedAsyncRunner,
} from "./serializedAsyncRunner";

describe("createSerializedAsyncRunner", () => {
  it("prevents an older cover save from completing after a newer photo save", async () => {
    const run = createSerializedAsyncRunner();
    const events: string[] = [];
    let finishOldSave!: () => void;
    const oldSaveGate = new Promise<void>((resolve) => {
      finishOldSave = resolve;
    });

    const oldSave = run(async () => {
      events.push("old-start");
      await oldSaveGate;
      events.push("old-end");
    });
    const photoSave = run(async () => {
      events.push("photo-start");
      events.push("photo-end");
    });

    await Promise.resolve();
    expect(events).toEqual(["old-start"]);
    finishOldSave();
    await Promise.all([oldSave, photoSave]);
    expect(events).toEqual(["old-start", "old-end", "photo-start", "photo-end"]);
  });

  it("waits for old and final cover saves before export finalization", async () => {
    const run = createSerializedAsyncRunner();
    const events: string[] = [];
    let finishOldSave!: () => void;
    const oldSaveGate = new Promise<void>((resolve) => {
      finishOldSave = resolve;
    });

    const oldSave = run(async () => {
      events.push("old-save-start");
      await oldSaveGate;
      events.push("old-save-end");
    });
    const exportFlow = (async () => {
      await run(async () => {
        events.push("final-cover-save");
      });
      events.push("finalize");
    })();

    await Promise.resolve();
    expect(events).toEqual(["old-save-start"]);
    finishOldSave();
    await Promise.all([oldSave, exportFlow]);
    expect(events).toEqual([
      "old-save-start",
      "old-save-end",
      "final-cover-save",
      "finalize",
    ]);
  });
});

describe("createLatestAsyncRunner", () => {
  it("keeps the active request and collapses queued values to the latest one", async () => {
    let finishFirst!: () => void;
    const firstGate = new Promise<void>((resolve) => {
      finishFirst = resolve;
    });
    const calls: string[] = [];
    const runner = createLatestAsyncRunner<string>({
      run: async (value) => {
        calls.push(value);
        if (value === "first") await firstGate;
      },
    });

    runner.enqueue("first");
    runner.enqueue("middle");
    runner.enqueue("latest");
    expect(calls).toEqual(["first"]);

    finishFirst();
    await runner.waitForIdle();
    expect(calls).toEqual(["first", "latest"]);
  });

  it("continues with a newer value after an in-flight failure", async () => {
    let failOld!: (error: unknown) => void;
    const oldGate = new Promise<void>((_, reject) => {
      failOld = reject;
    });
    const calls: string[] = [];
    const errors: string[] = [];
    const runner = createLatestAsyncRunner<string>({
      run: async (value) => {
        calls.push(value);
        if (value === "old") await oldGate;
      },
      onError: (_, value) => errors.push(value),
    });

    runner.enqueue("old");
    runner.enqueue("latest");
    failOld(new Error("slow request failed"));

    await runner.waitForIdle();
    expect(calls).toEqual(["old", "latest"]);
    expect(errors).toEqual(["old"]);
    expect(runner.getLatest()).toBe("latest");
  });

  it("retains the failed latest value for retry", async () => {
    let shouldFail = true;
    const calls: string[] = [];
    const runner = createLatestAsyncRunner<string>({
      run: async (value) => {
        calls.push(value);
        if (shouldFail) throw new Error("offline");
      },
    });

    runner.enqueue("latest");
    await runner.waitForIdle();
    shouldFail = false;
    runner.retryLatest();
    await runner.waitForIdle();

    expect(calls).toEqual(["latest", "latest"]);
  });

  it("waits for the final coalesced value at an explicit persistence boundary", async () => {
    const run = vi.fn(async () => undefined);
    const runner = createLatestAsyncRunner({ run });

    runner.enqueue("draft");
    runner.enqueue("final");
    await runner.waitForIdle();

    expect(run).toHaveBeenLastCalledWith("final");
  });
});