export type RenderDiagnosticCode =
  | "RND-QUERY-CLIENT"
  | "RND-USER-CONTEXT"
  | "RND-HOOK-ORDER"
  | "RND-UPDATE-DEPTH"
  | "RND-INVALID-CHILD"
  | "RND-INVALID-ELEMENT"
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

const MAX_COMPONENT_DEPTH = 64;

const ACTIONABLE_MESSAGE_CODES: ReadonlyArray<{
  code: RenderDiagnosticCode;
  matches: (message: string) => boolean;
}> = [
  {
    code: "RND-QUERY-CLIENT",
    matches: (message) =>
      message.includes("no queryclient set") ||
      (message.includes("queryclient") &&
        message.includes("queryclientprovider")),
  },
  {
    code: "RND-USER-CONTEXT",
    matches: (message) =>
      (message.includes("useuser") && message.includes("userprovider")) ||
      (message.includes("userprovider") && message.includes("userid")) ||
      (message.includes("user context") && message.includes("provider")) ||
      (message.includes("identity context") && message.includes("provider")),
  },
  {
    code: "RND-HOOK-ORDER",
    matches: (message) =>
      message.includes("rendered more hooks") ||
      message.includes("rendered fewer hooks") ||
      message.includes("change in the order of hooks") ||
      message.includes("should have a queue") ||
      message.includes("hook queue"),
  },
  {
    code: "RND-UPDATE-DEPTH",
    matches: (message) => message.includes("maximum update depth exceeded"),
  },
  {
    code: "RND-INVALID-CHILD",
    matches: (message) =>
      message.includes("objects are not valid as a react child") ||
      message.includes("not a valid react child"),
  },
  {
    code: "RND-INVALID-ELEMENT",
    matches: (message) =>
      message.includes("element type is invalid") ||
      message.includes("invalid element type"),
  },
];

export type ComponentStackDiagnostic = {
  componentFingerprint: string;
  componentDepth: number;
};

/**
 * Reduces React's component stack to compact, bounded metadata. Component
 * frames are static code identifiers rather than user-authored content. The
 * raw stack never enters another diagnostics or telemetry dependency.
 */
export function getComponentStackDiagnostic(
  componentStack: unknown,
): ComponentStackDiagnostic {
  const stack = typeof componentStack === "string" ? componentStack : "";
  let hash = 0x811c9dc5;
  for (let index = 0; index < stack.length; index += 1) {
    hash ^= stack.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }

  const depth = stack
    .split(/\r?\n/)
    .reduce(
      (count, line) =>
        count < MAX_COMPONENT_DEPTH && line.trim().length > 0
          ? count + 1
          : count,
      0,
    );

  return {
    componentFingerprint: (hash >>> 0).toString(16).padStart(8, "0"),
    componentDepth: Math.min(depth, MAX_COMPONENT_DEPTH),
  };
}


export function shouldSendRenderDiagnostic(dedupeKey: string): boolean {
  if (sentRenderDiagnostics.has(dedupeKey)) return false;
  sentRenderDiagnostics.add(dedupeKey);
  return true;
}

export function getRenderDiagnosticDedupeKey(
  diagnosticCode: RenderDiagnosticCode,
  componentFingerprint: string,
  nativeBuildIdentifier: string | null,
): string {
  return [
    diagnosticCode,
    componentFingerprint,
    nativeBuildIdentifier ?? "none",
  ].join(":");
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
  const message = error instanceof Error ? error.message.toLowerCase() : "";
  const actionableCode = ACTIONABLE_MESSAGE_CODES.find(({ matches }) =>
    matches(message),
  )?.code;
  return {
    errorClass,
    diagnosticCode:
      actionableCode ??
      RENDER_ERROR_CODES[errorClass] ??
      "RND-UNKNOWN",
  };
}