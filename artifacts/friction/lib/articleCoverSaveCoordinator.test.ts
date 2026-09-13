import { beforeEach, describe, expect, it } from "vitest";
import {
  markArticleCoverSaveCommitted,
  queueLatestArticleCoverSave,
  resetArticleCoverSaveCoordinatorForTests,
  waitForLatestArticleCoverSave,
} from "./articleCoverSaveCoordinator";

beforeEach(() => resetArticleCoverSaveCoordinatorForTests());

describe("article cover save coordinator", () => {
  it("coalesces saves across separate screen callers for the same article", async () => {
    let finishOld!: () => void;
    const oldGate = new Promise<void>((resolve) => {
      finishOld = resolve;
    });
    const events: string[] = [];

    queueLatestArticleCoverSave("article", {
      value: "old",
      save: async () => {
        events.push("old-start");
        await oldGate;
        events.push("old-end");
      },
      onLatestSaved: () => events.push("old-reconciled"),
      onLatestError: () => undefined,
    });
    queueLatestArticleCoverSave("article", {
      value: "latest",
      save: async () => {
        events.push("latest-save");
      },
      onLatestSaved: () => events.push("latest-reconciled"),
      onLatestError: () => undefined,
    });

    finishOld();
    await waitForLatestArticleCoverSave("article");
    expect(events).toEqual([
      "old-start",
      "old-end",
      "latest-save",
      "latest-reconciled",
    ]);
  });

  it("makes an old retry action harmless after a verified photo commit", async () => {
    let retryOld!: () => void;
    const saves: string[] = [];
    queueLatestArticleCoverSave("article", {
      value: "old",
      save: async () => {
        saves.push("old");
        throw new Error("offline");
      },
      onLatestSaved: () => undefined,
      onLatestError: (_, retry) => {
        retryOld = retry;
      },
    });
    expect(await waitForLatestArticleCoverSave("article")).toBe(false);

    markArticleCoverSaveCommitted("article", "photo");
    retryOld();
    expect(await waitForLatestArticleCoverSave("article")).toBe(true);
    expect(saves).toEqual(["old"]);
  });

  it("reports a failed latest save so export can stay retryable", async () => {
    queueLatestArticleCoverSave("article", {
      value: "latest",
      save: async () => {
        throw new Error("offline");
      },
      onLatestSaved: () => undefined,
      onLatestError: () => undefined,
    });

    expect(await waitForLatestArticleCoverSave("article")).toBe(false);
  });
});