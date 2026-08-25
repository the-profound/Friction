import { describe, expect, it, vi } from "vitest";
import {
  canCreateSpaceRound,
  createOrReuseSpaceRound,
} from "./spaceRoundCreation";

describe("space round creation", () => {
  it("allows only approved operators to create rounds", () => {
    expect(canCreateSpaceRound({ role: "OPERATOR", status: "APPROVED" })).toBe(true);
    expect(canCreateSpaceRound({ role: "PARTICIPANT", status: "APPROVED" })).toBe(false);
    expect(canCreateSpaceRound({ role: "OPERATOR", status: "WITHDRAWN" })).toBe(false);
  });

  it("reuses a committed round when a retry finds a uniqueness conflict", async () => {
    const existing = { id: "round-1", roundNumber: 1 };
    const insert = vi.fn(async () => null);
    const findExisting = vi.fn(async () => existing);

    await expect(createOrReuseSpaceRound({ insert, findExisting })).resolves.toEqual({
      round: existing,
      replayed: true,
    });
    expect(insert).toHaveBeenCalledOnce();
    expect(findExisting).toHaveBeenCalledOnce();
  });
});