import { describe, expect, it } from "vitest";
import { LatestSnapshotQueue } from "../latestSnapshotQueue";

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("LatestSnapshotQueue", () => {
  it("keeps one active write and only the newest pending dirty snapshot", async () => {
    const first = deferred();
    const writes: string[] = [];
    const queue = new LatestSnapshotQueue<string>(async (value) => {
      writes.push(value);
      if (value === "first") await first.promise;
    });

    queue.enqueueLatest("first");
    queue.enqueueLatest("stale-" + "한글😀".repeat(20_000));
    queue.enqueueLatest("latest-" + "긴무공백".repeat(20_000));

    expect(queue.getStats()).toEqual({
      active: true,
      pendingLatest: true,
      barriers: 0,
    });
    first.resolve();
    await queue.whenIdle();
    expect(writes).toHaveLength(2);
    expect(writes[0]).toBe("first");
    expect(writes[1].startsWith("latest-")).toBe(true);
  });

  it("does not merge latest snapshots across delete or transition barriers", async () => {
    const first = deferred();
    const writes: string[] = [];
    const queue = new LatestSnapshotQueue<string>(async (value) => {
      writes.push(value);
      if (value === "active-save") await first.promise;
    });

    queue.enqueueLatest("active-save");
    queue.enqueueLatest("latest-before-delete");
    const deletion = queue.enqueueBarrier("delete");
    queue.enqueueLatest("latest-after-transition");
    first.resolve();

    await deletion;
    await queue.whenIdle();
    expect(writes).toEqual([
      "active-save",
      "latest-before-delete",
      "delete",
      "latest-after-transition",
    ]);
  });

  it("continues with the newest snapshot after a failed coalesced write", async () => {
    const writes: string[] = [];
    const errors: unknown[] = [];
    const queue = new LatestSnapshotQueue<string>(
      async (value) => {
        writes.push(value);
        if (value === "failed") throw new Error("native storage stopped");
      },
      undefined,
      (error) => errors.push(error),
    );

    queue.enqueueLatest("failed");
    queue.enqueueLatest("recovered-latest");
    await queue.whenIdle();

    expect(writes).toEqual(["failed", "recovered-latest"]);
    expect(errors).toHaveLength(1);
  });

  it("rejects the durability barrier when the newest physical write fails", async () => {
    const queue = new LatestSnapshotQueue<string>(async () => {
      throw new Error("storage unavailable");
    });
    queue.enqueueLatest("latest");
    await expect(queue.whenIdle()).rejects.toThrow("storage unavailable");
  });
});