import { describe, expect, it } from "vitest";

import {
  getRenderDiagnostic,
  shouldSendRenderDiagnostic,
} from "../renderErrorDiagnostics";

describe("render error diagnostics privacy contract", () => {
  it.each([
    [new TypeError("private@example.com token"), "TypeError", "RND-TYPE"],
    [new ReferenceError("secret response body"), "ReferenceError", "RND-REFERENCE"],
    [new Error("user content"), "Error", "RND-ERROR"],
  ])("maps only the error class to a bounded code", (error, errorClass, code) => {
    expect(getRenderDiagnostic(error)).toEqual({
      errorClass,
      diagnosticCode: code,
    });
  });

  it("does not expose custom names or raw values", () => {
    const error = new Error("user@example.com access-token-value");
    error.name = "user@example.com";

    expect(getRenderDiagnostic(error)).toEqual({
      errorClass: "UnknownError",
      diagnosticCode: "RND-UNKNOWN",
    });
  });

  it("suppresses a repeated error diagnostic in the same app session", () => {
    const key = `RND-RANGE:dedupe-test-${Date.now()}`;
    expect(shouldSendRenderDiagnostic(key)).toBe(true);
    expect(shouldSendRenderDiagnostic(key)).toBe(false);
  });
});