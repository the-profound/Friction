import { describe, expect, it } from "vitest";

import { getSafeRenderErrorDiagnostic } from "./clientLogs";

const requestId = "req_1234567890abcdefghij";

describe("render-error diagnostic privacy contract", () => {
  it("retains only supportable, allowlisted fields", () => {
    expect(
      getSafeRenderErrorDiagnostic({
        message: "render-error",
        name: "TypeError",
        diagnosticCode: "RND-TYPE",
        platform: "ios",
        appVersion: "1.0.0",
        buildNumber: "42",
        requestId,
      }),
    ).toEqual({
      errorClass: "TypeError",
      diagnosticCode: "RND-TYPE",
      platform: "ios",
      appVersion: "1.0.0",
      buildNumber: "42",
      requestId,
      release: null,
    });
  });

  it.each([
    { message: "private message", name: "TypeError", diagnosticCode: "RND-TYPE" },
    { message: "render-error", name: "Email_user@example.com", diagnosticCode: "RND-TYPE" },
    { message: "render-error", name: "TypeError", diagnosticCode: "user@example.com" },
    { message: "render-error", name: "TypeError", diagnosticCode: "RND-ERROR" },
    { message: "render-error", name: "TypeError", diagnosticCode: "RND-TYPE", stack: "secret stack" },
  ])("rejects raw or non-allowlisted diagnostic data", (input) => {
    expect(getSafeRenderErrorDiagnostic(input)).toBeNull();
  });
});