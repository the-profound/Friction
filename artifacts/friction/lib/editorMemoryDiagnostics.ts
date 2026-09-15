export type EditorMemoryOperation = "autosave" | "webview-command";
export type EditorMemoryLifecycle = "booting" | "active" | "reset" | "unmounted";

export type EditorMemoryDiagnostic = {
  operation: EditorMemoryOperation;
  lifecycle: EditorMemoryLifecycle;
  sizeBucket: "0" | "1-16k" | "16-64k" | "64-256k" | "256k+";
  pendingBucket: "0" | "1-2" | "3-4" | "5+";
};

type DiagnosticInput = {
  operation: EditorMemoryOperation;
  lifecycle: EditorMemoryLifecycle;
  payloadChars: number;
  pendingOperations: number;
};

declare global {
  var __frictionEditorMemoryDiagnostic: EditorMemoryDiagnostic | undefined;
}

let lastPersistedRiskKey: string | null = null;

export function getEditorSizeBucket(chars: number): EditorMemoryDiagnostic["sizeBucket"] {
  if (chars <= 0) return "0";
  if (chars <= 16_384) return "1-16k";
  if (chars <= 65_536) return "16-64k";
  if (chars <= 262_144) return "64-256k";
  return "256k+";
}

export function getEditorPendingBucket(count: number): EditorMemoryDiagnostic["pendingBucket"] {
  if (count <= 0) return "0";
  if (count <= 2) return "1-2";
  if (count <= 4) return "3-4";
  return "5+";
}

export function updateEditorMemoryDiagnostic(input: DiagnosticInput): void {
  const diagnostic: EditorMemoryDiagnostic = {
    operation: input.operation,
    lifecycle: input.lifecycle,
    sizeBucket: getEditorSizeBucket(input.payloadChars),
    pendingBucket: getEditorPendingBucket(input.pendingOperations),
  };
  globalThis.__frictionEditorMemoryDiagnostic = diagnostic;

  if (
    diagnostic.sizeBucket === "0"
    || diagnostic.sizeBucket === "1-16k"
  ) {
    if (diagnostic.pendingBucket !== "5+") return;
  }
  const riskKey = [
    diagnostic.operation,
    diagnostic.lifecycle,
    diagnostic.sizeBucket,
    diagnostic.pendingBucket,
  ].join(":");
  if (riskKey === lastPersistedRiskKey) return;
  lastPersistedRiskKey = riskKey;
  try {
    // Keep this synchronous and tiny: the process may be under memory pressure.
    // No title, body, message, stack, identifier, or exact byte count is stored.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { File, Paths } = require("expo-file-system") as typeof import("expo-file-system");
    const file = new File(Paths.document, "friction-last-fatal-crash.json");
    file.write(JSON.stringify({
      source: "editor-memory-risk",
      message: "editor-memory-risk",
      isFatal: false,
      timestamp: new Date().toISOString(),
      editorMemory: diagnostic,
    }));
  } catch {
    // Diagnostics must never interfere with editing or web rendering.
  }
}