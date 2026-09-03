import { describe, expect, it } from "vitest";
import { canResendSpaceScheduledSend } from "../spaceScheduledSendPresentation";

describe("scheduled send resend presentation", () => {
  it("never exposes resend for expired immutable CENTER reservations", () => {
    expect(canResendSpaceScheduledSend("SENT", "CENTER", false)).toBe(false);
    expect(canResendSpaceScheduledSend("FAILED", "CENTER", false)).toBe(false);
    expect(canResendSpaceScheduledSend("CANCELLED", "CENTER", false)).toBe(false);
    expect(canResendSpaceScheduledSend("FAILED", "OPENING", false)).toBe(true);
    expect(canResendSpaceScheduledSend("SENT", "OPENING", true)).toBe(false);
  });
});