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

  it("strips unknown raw stack fields before route logging", () => {
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
      expect(parsed.data).not.toHaveProperty("componentStack");
    }
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

describe("editor-memory-risk diagnostic privacy contract", () => {
  it("accepts only bounded memory-pressure metadata", () => {
    const parsed = ReportClientLogBody.safeParse({
      source: "editor-memory-risk",
      message: "editor-memory-risk",
      name: "EditorMemoryRisk",
      isFatal: false,
      editorMemory: {
        operation: "autosave",
        lifecycle: "active",
        sizeBucket: "64-256k",
        pendingBucket: "1-2",
      },
    });
    expect(parsed.success).toBe(true);
  });

  it("rejects raw content and exact sizes", () => {
    expect(ReportClientLogBody.safeParse({
      source: "editor-memory-risk",
      message: "editor-memory-risk",
      editorMemory: {
        operation: "autosave",
        lifecycle: "active",
        sizeBucket: "100000",
        pendingBucket: "private body",
      },
    }).success).toBe(false);
  });
});
