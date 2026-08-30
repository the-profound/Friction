import { describe, expect, it } from "vitest";
import { createSerializedAsyncRunner } from "./serializedAsyncRunner";

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