import { describe, expect, it, vi } from "vitest";
import { createOrReuseSpace } from "./spaceCreationReplay";

describe("space creation response-loss recovery", () => {
  it("does not insert a second real-name space when a retried key already exists", async () => {
    const committedSpace = { id: "real-name-space", isAnonymous: false };
    const findExisting = vi.fn(async () => committedSpace);
    const create = vi.fn(async () => ({ id: "should-not-create" }));

    await expect(createOrReuseSpace({ findExisting, create })).resolves.toEqual({
      space: committedSpace,
      replayed: true,
    });
    expect(create).not.toHaveBeenCalled();
  });

  it("recovers an anonymous space after a concurrent key conflict", async () => {
    const committedSpace = { id: "anonymous-space", isAnonymous: true };
    const findExisting = vi
      .fn<() => Promise<typeof committedSpace | null>>()
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce(committedSpace);
    const create = vi.fn(async () => {
      throw new Error("unique creation key");
    });

    await expect(createOrReuseSpace({ findExisting, create })).resolves.toEqual({
      space: committedSpace,
      replayed: true,
    });
    expect(create).toHaveBeenCalledOnce();
  });
});