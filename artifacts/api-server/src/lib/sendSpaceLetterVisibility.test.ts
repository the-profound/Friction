import { describe, expect, it } from "vitest";

import {
  resolveSendSpaceLetterVisibility,
  validateSendSpaceLetterVisibilityTarget,
} from "./sendSpaceLetterVisibility";

describe("send-records space letter visibility policy", () => {
  it("defaults regular spaces to PUBLIC and preserves an explicit choice", () => {
    expect(resolveSendSpaceLetterVisibility(false)).toBe("PUBLIC");
    expect(resolveSendSpaceLetterVisibility(false, "PUBLIC")).toBe("PUBLIC");
    expect(resolveSendSpaceLetterVisibility(false, "RECIPIENT_ONLY")).toBe(
      "RECIPIENT_ONLY",
    );
  });

  it("forces anonymous spaces to RECIPIENT_ONLY even for a tampered request", () => {
    expect(resolveSendSpaceLetterVisibility(true)).toBe("RECIPIENT_ONLY");
    expect(resolveSendSpaceLetterVisibility(true, "PUBLIC")).toBe(
      "RECIPIENT_ONLY",
    );
  });

  it("accepts visibility only for space sends", () => {
    expect(validateSendSpaceLetterVisibilityTarget("space", "PUBLIC")).toBeNull();
    expect(validateSendSpaceLetterVisibilityTarget("person")).toBeNull();
    expect(validateSendSpaceLetterVisibilityTarget("person", "PUBLIC")).toBe(
      "spaceLetterVisibility is only valid for space sends",
    );
    expect(validateSendSpaceLetterVisibilityTarget("reply", "RECIPIENT_ONLY")).toBe(
      "spaceLetterVisibility is only valid for space sends",
    );
  });
});
