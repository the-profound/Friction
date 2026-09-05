export type RenderDiagnosticCode =
  | "RND-ERROR"
  | "RND-TYPE"
  | "RND-REFERENCE"
  | "RND-SYNTAX"
  | "RND-RANGE"
  | "RND-URI"
  | "RND-EVAL"
  | "RND-UNKNOWN";

const sentRenderDiagnostics = new Set<string>();

const RENDER_ERROR_CODES: Readonly<Record<string, RenderDiagnosticCode>> = {
  Error: "RND-ERROR",
  TypeError: "RND-TYPE",
  ReferenceError: "RND-REFERENCE",
  SyntaxError: "RND-SYNTAX",
  RangeError: "RND-RANGE",
  URIError: "RND-URI",
  EvalError: "RND-EVAL",
};

export function shouldSendRenderDiagnostic(dedupeKey: string): boolean {
  if (sentRenderDiagnostics.has(dedupeKey)) return false;
  sentRenderDiagnostics.add(dedupeKey);
  return true;
}

export function getRenderDiagnostic(error: unknown): {
  errorClass: string;
  diagnosticCode: RenderDiagnosticCode;
} {
  const errorClass =
    error instanceof Error &&
    Object.prototype.hasOwnProperty.call(RENDER_ERROR_CODES, error.name)
      ? error.name
      : "UnknownError";
  return {
    errorClass,
    diagnosticCode: RENDER_ERROR_CODES[errorClass] ?? "RND-UNKNOWN",
  };
}