import { describe, expect, it } from "vitest";

import {
  getRenderDiagnostic,
  getComponentStackDiagnostic,
  getRenderDiagnosticDedupeKey,
  shouldSendRenderDiagnostic,
} from "../renderErrorDiagnostics";
import {
  getEditorPendingBucket,
  getEditorSizeBucket,
  updateEditorMemoryDiagnostic,
} from "../editorMemoryDiagnostics";

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

  it.each([
    ["No QueryClient set, use QueryClientProvider to set one", "RND-QUERY-CLIENT"],
    ["useUser must be used within a UserProvider", "RND-USER-CONTEXT"],
    ["UserProvider rendered without a userId", "RND-USER-CONTEXT"],
    ["Rendered fewer hooks than expected", "RND-HOOK-ORDER"],
    ["Should have a queue. This is likely a bug in React.", "RND-HOOK-ORDER"],
    ["Maximum update depth exceeded", "RND-UPDATE-DEPTH"],
    ["Objects are not valid as a React child", "RND-INVALID-CHILD"],
    ["Element type is invalid: expected a string", "RND-INVALID-ELEMENT"],
  ])("maps a known message locally to %s", (message, diagnosticCode) => {
    expect(getRenderDiagnostic(new Error(message))).toEqual({
      errorClass: "Error",
      diagnosticCode,
    });
  });

  it("fingerprints component stacks deterministically without returning text", () => {
    const stack = "\n    at PrivateAccount (secret.tsx:1)\n    at Root";
    const first = getComponentStackDiagnostic(stack);
    expect(first).toEqual(getComponentStackDiagnostic(stack));
    expect(first.componentFingerprint).toMatch(/^[a-f0-9]{8}$/);
    expect(first.componentDepth).toBe(2);
    expect(JSON.stringify(first)).not.toContain("PrivateAccount");
  });

  it("bounds component depth", () => {
    const diagnostic = getComponentStackDiagnostic(
      Array.from({ length: 100 }, (_, index) => `at C${index}`).join("\n"),
    );
    expect(diagnostic.componentDepth).toBe(64);
  });

  it("dedupes by code, component fingerprint, and native build identity", () => {
    expect(
      getRenderDiagnosticDedupeKey("RND-HOOK-ORDER", "abcdef01", "42"),
    ).toBe("RND-HOOK-ORDER:abcdef01:42");
    expect(
      getRenderDiagnosticDedupeKey("RND-HOOK-ORDER", "abcdef01", "43"),
    ).not.toBe("RND-HOOK-ORDER:abcdef01:42");
  });

  it("suppresses a repeated error diagnostic in the same app session", () => {
    const key = `RND-RANGE:dedupe-test-${Date.now()}`;
    expect(shouldSendRenderDiagnostic(key)).toBe(true);
    expect(shouldSendRenderDiagnostic(key)).toBe(false);
  });
});

describe("editor memory diagnostics privacy contract", () => {
  it("stores only bounded operation, lifecycle, size, and queue buckets", () => {
    const privateText = "private@example.com 비밀 원문 😀";
    updateEditorMemoryDiagnostic({
      operation: "autosave",
      lifecycle: "active",
      payloadChars: privateText.length,
      pendingOperations: 2,
    });

    expect(globalThis.__frictionEditorMemoryDiagnostic).toEqual({
      operation: "autosave",
      lifecycle: "active",
      sizeBucket: "1-16k",
      pendingBucket: "1-2",
    });
    expect(JSON.stringify(globalThis.__frictionEditorMemoryDiagnostic)).not.toContain(
      privateText,
    );
  });

  it("bounds large Unicode payload and queue counts without inspecting content", () => {
    expect(getEditorSizeBucket("한글😀".repeat(70_000).length)).toBe("256k+");
    expect(getEditorPendingBucket(100_000)).toBe("5+");
  });

  it("defines a privacy-safe next-launch risk record without raw diagnostics", async () => {
    const source = await import("node:fs").then(({ readFileSync }) =>
      readFileSync(new URL("../editorMemoryDiagnostics.ts", import.meta.url), "utf8"),
    );
    expect(source).toContain('source: "editor-memory-risk"');
    expect(source).toContain("editorMemory: diagnostic");
    expect(source).not.toContain("error.message");
    expect(source).not.toContain("error.stack");
  });
});