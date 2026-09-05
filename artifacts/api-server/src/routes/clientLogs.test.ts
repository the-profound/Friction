import { describe, expect, it } from "vitest";

import { ReportClientLogBody } from "@workspace/api-zod";
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
        componentFingerprint: "12ab34cd",
        componentDepth: 9,
      }),
    ).toEqual({
      errorClass: "TypeError",
      diagnosticCode: "RND-TYPE",
      platform: "ios",
      appVersion: "1.0.0",
      buildNumber: "42",
      requestId,
      componentFingerprint: "12ab34cd",
      componentDepth: 9,
      release: null,
    });
  });

  it.each([
    { message: "private message", name: "TypeError", diagnosticCode: "RND-TYPE" },
    { message: "render-error", name: "Email_user@example.com", diagnosticCode: "RND-TYPE" },
    { message: "render-error", name: "TypeError", diagnosticCode: "user@example.com" },
    { message: "render-error", name: "TypeError", diagnosticCode: "RND-ERROR" },
    { message: "render-error", name: "TypeError", diagnosticCode: "RND-TYPE", componentFingerprint: "BAD", componentDepth: 2 },
    { message: "render-error", name: "TypeError", diagnosticCode: "RND-TYPE", componentFingerprint: "12ab34cd", componentDepth: 65 },
  ])("rejects raw or non-allowlisted diagnostic data", (input) => {
    expect(getSafeRenderErrorDiagnostic(input)).toBeNull();
  });

  it("accepts actionable codes independently of the safe error class", () => {
    expect(
      getSafeRenderErrorDiagnostic({
        message: "render-error",
        name: "TypeError",
        diagnosticCode: "RND-HOOK-ORDER",
        componentFingerprint: "abcdef01",
        componentDepth: 3,
      }),
    ).toMatchObject({
      errorClass: "TypeError",
      diagnosticCode: "RND-HOOK-ORDER",
      componentFingerprint: "abcdef01",
      componentDepth: 3,
    });
  });

  it.each([
    { message: "private@example.com secret" },
    { componentFingerprint: "ABCDEF01" },
  ])("rejects malformed component metadata at the schema", (extra) => {
    expect(
      ReportClientLogBody.safeParse({
        source: "render-error",
        message: "render-error",
        name: "Error",
        diagnosticCode: "RND-ERROR",
        componentFingerprint: "abcdef01",
        componentDepth: 2,
        ...extra,
      }).success,
    ).toBe(false);
  });

  it("accepts the temporary component stack field but strips unknown JS stacks", () => {
    const parsed = ReportClientLogBody.safeParse({
      source: "render-error",
      message: "render-error",
      name: "Error",
      diagnosticCode: "RND-ERROR",
      componentFingerprint: "abcdef01",
      componentDepth: 2,
      stack: "at PrivateUser (private.tsx:1)",
      componentStack: "at PrivateUser (private.tsx:1)",
    });
    expect(parsed.success).toBe(true);
    if (parsed.success) {
      expect(parsed.data).not.toHaveProperty("stack");
      expect(parsed.data.componentStack).toBe(
        "at PrivateUser (private.tsx:1)",
      );
    }
  });

  it("logs the component stack only for production iOS build 47 query errors", () => {
    const base = {
      message: "render-error",
      name: "Error",
      diagnosticCode: "RND-QUERY-CLIENT",
      componentFingerprint: "abcdef01",
      componentDepth: 2,
      platform: "ios",
      componentStack: "at QueryConsumer (screen.tsx:1)",
      release: {
        track: "production",
        configurationState: "valid",
        configurationFingerprint: "abcdef0123456789",
        supabaseHost: "example.supabase.co",
        apiHost: "example.replit.app",
      },
    };

    expect(
      getSafeRenderErrorDiagnostic({ ...base, buildNumber: "47" }),
    ).toMatchObject({
      componentStack: "at QueryConsumer (screen.tsx:1)",
    });
    expect(
      getSafeRenderErrorDiagnostic({ ...base, buildNumber: "46" }),
    ).not.toHaveProperty("componentStack");
    expect(
      getSafeRenderErrorDiagnostic({
        ...base,
        buildNumber: "47",
        diagnosticCode: "RND-HOOK-ORDER",
      }),
    ).not.toHaveProperty("componentStack");
  });

  it("rejects a non-integer component depth in the server sanitizer", () => {
    expect(
      getSafeRenderErrorDiagnostic({
        message: "render-error",
        name: "Error",
        diagnosticCode: "RND-ERROR",
        componentFingerprint: "abcdef01",
        componentDepth: 1.5,
      }),
    ).toBeNull();
  });
});
