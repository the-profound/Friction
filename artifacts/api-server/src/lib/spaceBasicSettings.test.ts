import { describe, expect, it } from "vitest";
import {
  getSpaceBasicSettingsAccessIssue,
  parseSpaceBasicSettingsInput,
  shouldBlockAnonymousConversion,
} from "./spaceBasicSettings";

describe("space basic settings", () => {
  it("trims valid basic settings values", () => {
    expect(
      parseSpaceBasicSettingsInput({
        name: "  새 공간  ",
        description: "  소개  ",
        isAnonymous: false,
      }),
    ).toEqual({
      success: true,
      data: {
        name: "새 공간",
        description: "소개",
        isAnonymous: false,
      },
    });
  });

  it("accepts anonymous operation without changing the operator nickname", () => {
    expect(
      parseSpaceBasicSettingsInput({
        name: "새 공간",
        description: null,
        isAnonymous: true,
      }),
    ).toEqual({
      success: true,
      data: {
        name: "새 공간",
        description: null,
        isAnonymous: true,
      },
    });
  });

  it("rejects invalid lengths and fields outside the basic-settings contract", () => {
    const invalidBodies = [
      {
        name: "",
        description: null,
        isAnonymous: false,
      },
      {
        name: "공간",
        description: "가".repeat(301),
        isAnonymous: false,
      },
      {
        name: "공간",
        description: null,
        isAnonymous: false,
        status: "ACTIVE",
      },
    ];

    for (const body of invalidBodies) {
      expect(parseSpaceBasicSettingsInput(body).success).toBe(false);
    }
  });

  it("allows only an approved operator in a recruiting space", () => {
    const operator = { role: "OPERATOR", status: "APPROVED" } as const;
    expect(getSpaceBasicSettingsAccessIssue("RECRUITING", operator)).toBeNull();
    expect(getSpaceBasicSettingsAccessIssue("ACTIVE", operator)).toBe(
      "NOT_RECRUITING",
    );
    expect(getSpaceBasicSettingsAccessIssue("ARCHIVED", operator)).toBe(
      "NOT_RECRUITING",
    );
    expect(
      getSpaceBasicSettingsAccessIssue("RECRUITING", {
        role: "PARTICIPANT",
        status: "APPROVED",
      }),
    ).toBe("FORBIDDEN");
    expect(
      getSpaceBasicSettingsAccessIssue("RECRUITING", {
        role: "OPERATOR",
        status: "PENDING",
      }),
    ).toBe("FORBIDDEN");
    expect(
      getSpaceBasicSettingsAccessIssue("RECRUITING", null),
    ).toBe("FORBIDDEN");
  });

  it("blocks only public-to-anonymous conversion with incomplete identities", () => {
    expect(shouldBlockAnonymousConversion(false, true, true, false)).toBe(true);
    expect(shouldBlockAnonymousConversion(false, true, false, true)).toBe(true);
    expect(shouldBlockAnonymousConversion(false, true, false, false)).toBe(
      false,
    );
    expect(shouldBlockAnonymousConversion(true, true, true, true)).toBe(false);
    expect(shouldBlockAnonymousConversion(true, false, true, true)).toBe(false);
  });
});
