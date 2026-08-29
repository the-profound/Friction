export type NativeBodyFontMode = "custom" | "fallback";

type Listener = (mode: NativeBodyFontMode) => void;

let mode: NativeBodyFontMode = "custom";
const listeners = new Set<Listener>();

export function getNativeBodyFontMode(): NativeBodyFontMode {
  return mode;
}

/**
 * A native WebView may fail or time out independently from its siblings.
 * Fallback is therefore session-sticky: once any body renderer needs it,
 * every editor/reader/measure WebView must use the same deterministic family.
 */
export function reportNativeBodyFontReady(ok: boolean): NativeBodyFontMode {
  if (!ok && mode !== "fallback") {
    mode = "fallback";
    for (const listener of listeners) listener(mode);
  }
  return mode;
}

export function subscribeNativeBodyFontMode(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}