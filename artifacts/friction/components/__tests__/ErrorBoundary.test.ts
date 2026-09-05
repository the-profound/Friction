import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const boundarySource = fs.readFileSync(
  path.resolve(process.cwd(), "components/ErrorBoundary.tsx"),
  "utf8",
);
const fallbackSource = fs.readFileSync(
  path.resolve(process.cwd(), "components/ErrorFallback.tsx"),
  "utf8",
);

describe("root error boundary diagnostics", () => {
  it("reports the caught error without forwarding the component stack", () => {
    expect(boundarySource).toContain("reportRenderError(error)");
    expect(boundarySource).not.toContain("reportRenderError(error, info.componentStack)");
  });

  it("shows only the bounded diagnostic code in production", () => {
    expect(fallbackSource).toContain("!__DEV__ && diagnosticCode");
    expect(fallbackSource).toContain("Diagnostic code: {diagnosticCode}");
    expect(fallbackSource).not.toContain(
      "!__DEV__ ? formatErrorDetails()",
    );
  });
});